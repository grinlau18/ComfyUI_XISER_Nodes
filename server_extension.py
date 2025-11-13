import os
import aiohttp
from aiohttp import web
import folder_paths
import logging

BASE_DIR = os.path.dirname(__file__)
FONTS_DIR = os.path.join(BASE_DIR, "fonts")

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def list_psd_files(request):
    try:
        input_dir = folder_paths.get_input_directory()
        psd_dir = os.path.join(input_dir, "psd_files")
        if not os.path.exists(psd_dir):
            os.makedirs(psd_dir, exist_ok=True)
            logger.debug(f"Created directory: {psd_dir}")
        
        files = [
            os.path.join("input", "psd_files", f) for f in os.listdir(psd_dir)
            if f.lower().endswith('.psd')
        ]
        logger.debug(f"Found PSD files: {files}")
        return web.json_response({"files": files})
    except Exception as e:
        logger.error(f"Error listing PSD files: {str(e)}")
        return web.json_response({"error": f"Server error: {str(e)}"}, status=500)


async def get_available_fonts(request):
    """
    返回fonts目录中的所有字体文件
    """
    try:
        os.makedirs(FONTS_DIR, exist_ok=True)
        fonts = []
        for filename in sorted(os.listdir(FONTS_DIR)):
            if not filename.lower().endswith((".ttf", ".otf", ".ttc")):
                continue

            fonts.append({
                "file": filename,
                "name": os.path.splitext(filename)[0],
                "url": f"/xiser/font-files/{filename}"
            })

        return web.json_response({"fonts": fonts})
    except Exception as e:
        logger.error(f"Error listing fonts: {str(e)}")
        return web.json_response({"error": f"Server error: {str(e)}"}, status=500)


async def serve_font_file(request):
    """
    将字体文件作为静态资源返回
    """
    filename = request.match_info.get("filename", "")
    safe_name = os.path.basename(filename)
    font_path = os.path.join(FONTS_DIR, safe_name)

    if not os.path.isfile(font_path):
        return web.json_response({"error": "Font not found"}, status=404)

    return web.FileResponse(font_path)
