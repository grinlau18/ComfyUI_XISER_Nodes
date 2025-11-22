import base64
import json
import math
import os
import sys
import threading
import time
from io import BytesIO

import aiohttp
from aiohttp import web
import folder_paths
import logging
from PIL import Image
from torchvision import transforms
from server import PromptServer

try:
    import torch
except ImportError:
    torch = None

BASE_DIR = os.path.dirname(__file__)
FONTS_DIR = os.path.join(BASE_DIR, "fonts")
COLOR_PRESETS_FILE = os.path.join(BASE_DIR, "web", "xiser_color_presets.json")

logging.basicConfig(level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


async def list_psd_files(request):
    try:
        input_dir = folder_paths.get_input_directory()
        psd_dir = os.path.join(input_dir, "psd_files")
        os.makedirs(psd_dir, exist_ok=True)
        files = [
            os.path.join("input", "psd_files", f)
            for f in os.listdir(psd_dir)
            if f.lower().endswith(".psd")
        ]
        return web.json_response({"files": files})
    except Exception as exc:
        logger.error("Error listing PSD files: %s", exc)
        return web.json_response({"error": str(exc)}, status=500)


async def get_available_fonts(request):
    try:
        os.makedirs(FONTS_DIR, exist_ok=True)
        fonts = []
        for filename in sorted(os.listdir(FONTS_DIR)):
            if not filename.lower().endswith((".ttf", ".otf", ".ttc")):
                continue
            fonts.append(
                {
                    "file": filename,
                    "name": os.path.splitext(filename)[0],
                    "url": f"/xiser/font-files/{filename}",
                }
            )
        return web.json_response({"fonts": fonts})
    except Exception as exc:
        logger.error("Error listing fonts: %s", exc)
        return web.json_response({"error": str(exc)}, status=500)


async def serve_font_file(request):
    filename = request.match_info.get("filename", "")
    safe_name = os.path.basename(filename)
    font_path = os.path.join(FONTS_DIR, safe_name)
    if not os.path.isfile(font_path):
        return web.json_response({"error": "Font not found"}, status=404)
    return web.FileResponse(font_path)


def _read_color_presets():
    if not os.path.isfile(COLOR_PRESETS_FILE):
        return {}
    try:
        with open(COLOR_PRESETS_FILE, "r", encoding="utf-8") as file:
            return json.load(file)
    except Exception as exc:
        logger.error("Failed to read color presets: %s", exc)
        return {}


def _write_color_presets(data):
    os.makedirs(os.path.dirname(COLOR_PRESETS_FILE), exist_ok=True)
    temp_path = f"{COLOR_PRESETS_FILE}.tmp"
    with open(temp_path, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
    os.replace(temp_path, COLOR_PRESETS_FILE)


async def handle_color_presets(request):
    if request.method == "GET":
        data = _read_color_presets()
        return web.json_response({"customSets": data.get("customSets", [])})

    if request.method == "POST":
        try:
            payload = await request.json()
        except Exception as exc:
            logger.error("Failed to parse presets payload: %s", exc)
            return web.json_response({"error": "Invalid JSON"}, status=400)

        custom_sets = payload.get("customSets")
        if not isinstance(custom_sets, list):
            return web.json_response({"error": "customSets must be an array"}, status=400)

        data = _read_color_presets()
        data["customSets"] = custom_sets
        try:
            _write_color_presets(data)
        except Exception as exc:
            logger.error("Failed to persist color presets: %s", exc)
            return web.json_response({"error": "Unable to write presets"}, status=500)

        return web.json_response({"customSets": data["customSets"]})

    return web.json_response({"error": "Method not allowed"}, status=405)


## BiRefNet helpers ----------------------------------------------------

BIRENET_SRC_ROOT = os.path.join(BASE_DIR, "src", "xiser_nodes")
BIRENET_REPO_DIR = os.path.join(BIRENET_SRC_ROOT, "birefnet_repo")
if BIRENET_SRC_ROOT not in sys.path:
    sys.path.insert(0, BIRENET_SRC_ROOT)
if BIRENET_REPO_DIR not in sys.path:
    sys.path.insert(0, BIRENET_REPO_DIR)

BIRENET_IMPORT_ERROR = None
try:
    from birefnet_repo.models.birefnet import BiRefNet
    from birefnet_repo.utils import check_state_dict
except ImportError as exc:  # pragma: no cover
    BiRefNet = None
    check_state_dict = None
    BIRENET_IMPORT_ERROR = str(exc)
    logger.error("Failed to import BiRefNet modules: %s", exc)

MODEL_CACHE = {}
MODEL_CACHE_LOCK = threading.Lock()
MODEL_ROOT = os.path.join(folder_paths.models_dir, "BiRefNet", "pth")
DEFAULT_MODEL_NAME = "BiRefNet-general-epoch_244.pth"
DEFAULT_INFERENCE_SIZE = (1024, 1024)
MIN_INFERENCE_DIMENSION = 64
MAX_INFERENCE_DIMENSION = 2048
MODEL_DOWNLOAD_URL = (
    "https://pan.baidu.com/s/12z3qUuqag3nqpN2NJ5pSzg?pwd=ek65\n"  # 第一个地址+换行符
    "https://drive.google.com/drive/folders/1s2Xe0cjq-2ctnJBR24563yMSCOu4CcxM"  # 第二个地址
)
CUTOUT_SUBFOLDER = "xiser_cutouts"


class BiRefNetModelNotFound(Exception):
    pass


def _resolve_image_path(filename, subfolder, type_hint):
    if not filename:
        raise ValueError("filename is required")
    sanitized, annotated_dir = folder_paths.annotated_filepath(filename)
    if not sanitized:
        raise ValueError("Invalid filename")
    if sanitized.startswith("/") or ".." in sanitized:
        raise ValueError("Invalid path")
    output_dir = annotated_dir or folder_paths.get_directory_by_type(type_hint or "output")
    if output_dir is None:
        raise ValueError("Unknown directory type")
    target_dir = output_dir
    if subfolder:
        target_dir = os.path.join(output_dir, subfolder)
        if os.path.commonpath(
            (os.path.abspath(target_dir), os.path.abspath(output_dir))
        ) != os.path.abspath(output_dir):
            raise ValueError("Invalid subfolder path")
    safe_name = os.path.basename(sanitized)
    filepath = os.path.join(target_dir, safe_name)
    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")
    return filepath


def _ensure_model_available():
    if not os.path.isdir(MODEL_ROOT):
        raise BiRefNetModelNotFound(f"Model directory does not exist: {MODEL_ROOT}")


def _list_model_files():
    _ensure_model_available()
    return [
        name
        for name in sorted(os.listdir(MODEL_ROOT))
        if name.lower().endswith(".pth")
    ]


def _select_model_path(model_name):
    models = _list_model_files()
    if not models:
        raise BiRefNetModelNotFound("No BiRefNet models( BiRefNet-general-epoch_244.pth ) found in ComfyUI/models/BiRefNet/pth")
    normalized = model_name if model_name in models else None
    if not normalized:
        normalized = DEFAULT_MODEL_NAME if DEFAULT_MODEL_NAME in models else models[0]
    return normalized, os.path.join(MODEL_ROOT, normalized)


def _load_birefnet_model(model_name=None):
    if torch is None:
        raise RuntimeError("PyTorch is required for BiRefNet")
    if BiRefNet is None or check_state_dict is None:
        msg = "BiRefNet modules are not importable"
        if BIRENET_IMPORT_ERROR:
            msg = f"{msg}: {BIRENET_IMPORT_ERROR}"
        raise RuntimeError(msg)
    selected_model_name, path = _select_model_path(model_name)
    with MODEL_CACHE_LOCK:
        cached = MODEL_CACHE.get(selected_model_name)
        if cached:
            return cached, selected_model_name
        model = BiRefNet(bb_pretrained=False)
        state_dict = torch.load(path, map_location="cpu", weights_only=True)
        state_dict = check_state_dict(state_dict)
        model.load_state_dict(state_dict)
        model.eval()
        model.cpu()
        MODEL_CACHE[selected_model_name] = model
        return model, selected_model_name


def _align_to_multiple(value, step):
    return ((value + step - 1) // step) * step


def _align_dimensions(width, height, multiple):
    return _align_to_multiple(width, multiple), _align_to_multiple(height, multiple)


def _calculate_inference_size(orig_size, max_megapixels):
    width, height = orig_size
    if width <= 0 or height <= 0:
        return DEFAULT_INFERENCE_SIZE
    max_pixels = max(0.1, max_megapixels) * 1_000_000
    orig_pixels = width * height
    if orig_pixels <= max_pixels:
        w = max(MIN_INFERENCE_DIMENSION, min(width, MAX_INFERENCE_DIMENSION))
        h = max(MIN_INFERENCE_DIMENSION, min(height, MAX_INFERENCE_DIMENSION))
        return _align_dimensions(w, h, 32)
    scale = math.sqrt(max_pixels / orig_pixels)
    scale = max(0.1, min(scale, 1.0))
    w = max(MIN_INFERENCE_DIMENSION, int(width * scale))
    h = max(MIN_INFERENCE_DIMENSION, int(height * scale))
    return _align_dimensions(w, h, 32)


def _prepare_tensor_from_image(image, target_size):
    transform = transforms.Compose(
        [
            transforms.Resize(target_size, interpolation=Image.BILINEAR),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    return transform(image).unsqueeze(0)


def _pil_to_data_url(image):
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _save_image_to_path(image, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path, compress_level=4)
    return path


def _run_birefnet_cutout(model, pil_image, device, max_megapixels):
    orig_size = pil_image.size
    target_size = _calculate_inference_size(orig_size, max_megapixels)
    tensor = _prepare_tensor_from_image(pil_image, target_size).to(device)
    model = model.to(device)
    with torch.no_grad():
        preds = model(tensor)[-1].sigmoid().to(torch.float32).cpu()
    model.to("cpu")
    mask = transforms.ToPILImage()(preds[0])
    mask = mask.resize(orig_size, Image.BILINEAR).convert("L")
    rgba = pil_image.convert("RGB")
    rgba.putalpha(mask)
    return rgba


async def cutout_image(request):
    if torch is None:
        return web.json_response({"error": "PyTorch is required"}, status=500)
    if Image is None:
        return web.json_response({"error": "Pillow is required"}, status=500)
    try:
        payload = await request.json()
    except Exception as exc:
        logger.error("Failed to parse cutout payload: %s", exc)
        return web.json_response({"error": "Invalid payload"}, status=400)

    image_data = payload.get("image_data")
    filename = payload.get("filename")
    subfolder = payload.get("subfolder", "")
    type_hint = payload.get("type", "output")
    model_name = payload.get("model")
    max_megapixels = float(payload.get("max_megapixels", 2.0))
    requested_device = payload.get("device")

    dest_path = None
    try:
        if image_data:
            _, _, payload_b64 = image_data.partition(",")
            decoded = base64.b64decode(payload_b64 if payload_b64 else image_data)
            pil_image = Image.open(BytesIO(decoded)).convert("RGB")
        else:
            dest_path = _resolve_image_path(filename, subfolder, type_hint)
            with Image.open(dest_path) as img:
                pil_image = img.convert("RGB")
    except Exception as exc:
        logger.error("Failed to load source image: %s", exc)
        return web.json_response({"error": str(exc)}, status=400)

    try:
        model, selected_model_name = _load_birefnet_model(model_name)
        device = torch.device(requested_device) if requested_device else torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if "cuda" in device.type and not torch.cuda.is_available():
            device = torch.device("cpu")
        rgba_image = _run_birefnet_cutout(model, pil_image, device, max_megapixels)
    except BiRefNetModelNotFound as exc:
        return web.json_response(
            {
                "error": "BiRefNet model missing",
                "detail": str(exc),
                "install_dir": MODEL_ROOT,
                "url": MODEL_DOWNLOAD_URL,
            },
            status=400,
        )
    except RuntimeError as exc:
        return web.json_response(
            {
                "error": "BiRefNet modules missing",
                "detail": str(exc),
                "suggestion": "pip install kornia==0.7.2 timm",
            },
            status=500,
        )
    except Exception as exc:
        logger.exception("BiRefNet inference failed")
        return web.json_response({"error": f"Inference error: {exc}"}, status=500)

    file_info = None
    if dest_path:
        _save_image_to_path(rgba_image, dest_path)
        file_info = {"filename": filename, "subfolder": subfolder, "type": type_hint}
    else:
        file_info = _save_image_to_path(
            rgba_image, os.path.join(folder_paths.get_output_directory(), CUTOUT_SUBFOLDER, f"canvas_cutout_{int(time.time()*1000)}.png")
        )
        file_info = {"filename": os.path.basename(file_info), "subfolder": CUTOUT_SUBFOLDER, "type": "output"}

    data_url = _pil_to_data_url(rgba_image)
    if not data_url:
        return web.json_response({"error": "Failed to serialize cutout"}, status=500)

    return web.json_response({"image": data_url, "model": selected_model_name, "file_info": file_info})


try:
    PromptServer.instance.app.router.add_get("/custom/list_psd_files", list_psd_files)
    PromptServer.instance.app.router.add_post("/xiser/cutout", cutout_image)
    PromptServer.instance.app.router.add_get("/xiser/fonts", get_available_fonts)
    PromptServer.instance.app.router.add_get("/xiser/font-files/{filename}", serve_font_file)
    PromptServer.instance.app.router.add_get("/xiser/color-presets", handle_color_presets)
    PromptServer.instance.app.router.add_post("/xiser/color-presets", handle_color_presets)
except Exception as exc:
    logger.warning("Failed to register routes: %s", exc)
