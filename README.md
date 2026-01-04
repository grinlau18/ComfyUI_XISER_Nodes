# ComfyUI_XISER_Nodes

<div align="center">

🌐 **Language Selection / 语言选择**

[**English Documentation**](README.md) • [**中文文档**](README_CN.md)

</div>

Welcome to **ComfyUI_XISER_Nodes**, a comprehensive custom node package for [ComfyUI](https://github.com/comfyanonymous/ComfyUI). This extension provides advanced visual editing capabilities including interactive multi-layer canvas with real-time transformations, professional PSD file import with layer extraction, versatile geometric shape generation with anti-aliased rendering, and sophisticated image processing tools. Features batch shape creation, mask manipulation, prompt management, data flow optimization, and workflow enhancement utilities for efficient AI image generation and editing workflows.

---

## Installation

**Install via ComfyUI's Manager**

1. Open the ComfyUI Manager
2. Search for `ComfyUI_XISER_Nodes` and install it

**Manual installation**

1. Clone this repository into the `custom_nodes` directory of your ComfyUI installation:
   ```bash
   git clone https://github.com/grinlau18/ComfyUI_XISER_Nodes.git
   ```
2. In the `ComfyUI_XISER_Nodes` directory, run:
   ```bash
   pip install -r requirements.txt
   ```
3. Restart ComfyUI to load the new nodes
4. Look for nodes under the `XISER_Nodes` category in the ComfyUI interface

**Dependencies**: Requires `torch`, `PIL`, `numpy`, `opencv-python`, and ComfyUI core libraries.

### Cutout Model Setup
The new cutout button in the canvas helper uses [BiRefNet](https://github.com/tamzi/bi-ref-net) to compute alpha masks. Follow these steps to activate it:

1. Download the `BiRefNet-general-epoch_244.pth` checkpoint and place it in `ComfyUI/models/BiRefNet/pth/`. You can retrieve the file from the official mirrors:
   - https://pan.baidu.com/s/12z3qUuqag3nqpN2NJ5pSzg?pwd=ek65
   - https://drive.google.com/drive/folders/1s2Xe0cjq-2ctnJBR24563yMSCOu4CcxM
2. Install the inference dependencies (if not already available) with `pip install kornia==0.7.2 timm` inside your ComfyUI environment.
3. Restart ComfyUI; the canvas cutout button will now call BiRefNet and preserve the trimmed result in both the UI and node outputs.

## Core Capabilities
- Multi-layer canvas editing with PSD import, BiRefNet cutouts, layer transformations, and mask-aware history.
- Visual node toolkit comprising curve/path/gradient editors, image management, shape/text generation, node coloring, and label helpers.
- Image/mask/file utilities for color adjustment, cropping, resizing, reordering, mirroring, and PSD layer handling.
- Data and workflow support including shape summaries, signal detection, shorthand serialization, list extraction, and divisible size correction.
- LLM automation powered by DeepSeek with an extensible provider interface ready for future models.

### 🖼️ Multi-layer Canvas Hub (XIS_Canvas)
- **Essence**: The central canvas integrating BiRefNet cutouts, PSD import, layer transformations, mask generation, transparency adjustment, and 20-step history.
- **Highlights**:
  - Drag, scale, rotate, hide/show, reorder layers with real-time preview, plus mouse-wheel scaling and Alt+wheel rotation.
  - Real-time adjustment of brightness, contrast, saturation, and transparency.
  - Customizable canvas size, borders, background, auto-sizing, display scaling, and custom scrollbars for smooth reading of long content.
  - BiRefNet cutouts, mask generation, and PSD multi-layer extraction seamlessly integrated, with XIS_CanvasMaskProcessor keeping masks synchronized with canvas state.
  - One-click output of trimmed results with transparent layers, eliminating manual cropping workflows.

#### Node Interface
![XIS_Canvas Node Interface](img/XIS_Canvas_1.jpeg)
#### Workflow Example: Import PSD for Regional Redrawing
![XIS_Canvas PSD Import Workflow](img/XIS_Canvas_2.jpeg)
#### Workflow Example: Regional Redrawing After Image Layered Typesetting
![XIS_Canvas Layered Typesetting Workflow](img/XIS_Canvas_3.jpeg)

### 🤖 LLM Automation Bridge (XIS_LLMOrchestrator)
- **Purpose**: Route instructions plus optional `image`/`pack_images` tensors to a selected LLM provider (currently supports DeepSeek, Qwen series, Kimi models, with more to come) and emit the reply as a STRING output for downstream nodes.
- **Inputs**: API Key field, free-form instruction text, optional system prompt, adjustable temperature/top-p/max tokens, and optional vision inputs (`image`, `pack_images`).
- **Attachment Processing**: Automatically converts all input images to PNG Base64 strings, truncating to the model's image limit for convenient multi-image requests.
- **Extensibility**: Providers register via lightweight config + interface, allowing new models or custom inference endpoints to be added without modifying node core logic.
- **Vision Support**: When `image`/`pack_images` inputs are connected, the node automatically switches to DeepSeek's `responses` endpoint (OpenAI-compatible multi-modal format), using `input_text` + `input_image` structure to meet official validation rules.
- **API Key Management**:
  - **Secure Storage**: API Keys are encrypted and stored in the `ComfyUI/user/API_keys/` directory, never saved in workflow or project files
  - **Key Manager**: Click the "API key management" button on the node to open the key management interface
  - **Profiles**: Support for multiple API Key profiles, each node can independently select a profile
  - **Usage Flow**:
    1. Click "API key management" button to open the key manager
    2. Enter a profile name in "Profile name" and your API Key in "API Key"
    3. Click "Save" to store the encrypted API Key
    4. Select the desired profile from the "Select API key" dropdown
    5. The configuration will be automatically applied to the current node
  - **Note**: API Key profiles are node-specific, different nodes can use different API Keys
  ![XIS_LLMOrchestrator Node Interface](img/XIS_LLMOrchestrator_1.jpeg)
  ![XIS_LLMOrchestrator Workflow Example](img/XIS_LLMOrchestrator_2.jpeg)
  ![XIS_LLMOrchestrator Workflow Example](img/XIS_LLMOrchestrator_3.jpeg)

### ✨ Visual Node Toolkit
- **XIS_CurveEditor**: Sculpt distribution curves for INT/FLOAT/HEX outputs, with a widget that exposes Bézier grips and HSV/RGB/LAB color interpolation.
  - Emits scalar sequences and optional colored lists so downstream nodes can hook into numeric ramps or palette cues.
  ![XIS_CurveEditor Interface](img/XIS_CurveEditor_1.jpeg)
  ![XIS_CurveEditor Distribution Generation](img/XIS_CurveEditor_2.jpeg)
- **XIS_CoordinatePath**: Sketch linear or curved paths with configurable segments, distribution modes, and direct exports of x/y coordinates plus progress percentages.
  - Curve mode uses Catmull-Rom splines with virtual endpoints for smooth routing, while linear mode honors uniform or eased spacing.
  ![XIS_CoordinatePath Coordinate Generation](img/XIS_CoordinatePath.jpeg)
- **XIS_MultiPointGradient**: Generate gradient images from control points using IDW, radial, Voronoi, soft IDW, or linear interpolation.
  - Backend weights or Voronoi regions feed torch tensors that can be used as masks, backgrounds, or texture fills.
  ![XIS_MultiPointGradient Gradient Generation](img/XIS_MultiPointGradient.jpeg)
- **XIS_ImageManager**: Browse, cache, and reorder uploads before emitting the preview-aware `pack_images` output.
  - Tracks enabled layers, upload order, thumbnails, deterministic IDs, and metadata so downstream nodes see consistent image packs.
  ![XIS_ImageManager Interface](img/XIS_ImageManager.jpeg)
- **XIS_ShapeAndText**: Produce shape or text masks with configurable fill/stroke, transparency, and batch `shape_data` inputs; it returns the shape image, mask, and background.
  - Supports circles, polygons, stars, hearts, flowers, spirals, sunbursts, and text (with local font loading), plus spacing, stroke, transform, and skew controls.
  ![XIS_ShapeAndText Shape Generation](img/XIS_ShapeAndText_1.jpeg)
  ![XIS_ShapeAndText Shape Transformation](img/XIS_ShapeAndText_2.jpeg)
- **changeNodeColor**: Paint node titles and bodies independently to keep large graphs readable and visually organized.
  - **Access**: Right-click any node and select "XISER Node Color Manager" from the context menu
  - **Color Selection**: Choose hex colors via color picker or select from curated presets
  - **Dual Color Control**: Independently adjust title background and body background colors
  - **Theme Support**: Switch between light and dark theme presets
  - **Preset Management**: Save custom color combinations for reuse, delete unwanted presets
  - **Batch Operations**: Select multiple nodes to apply colors to all selected nodes simultaneously
  - **Real-time Preview**: Colors are applied immediately as you adjust them
  - **Persistent Storage**: Custom presets are saved to `web/xiser_color_presets.json`
  ![Node Color Customization](img/changeNodeColor_1.jpeg)
- **XIS_Label**: Double-click to open HTML/Markdown editors (CodeMirror with textarea fallback), toggle editors, adjust backgrounds and text scale, and enjoy consistent spacing, list handling, markdown conversion, and smart scrollbars across languages.
  - Supports Markdown headings, lists, bold/italic, inline code, and links before rendering parsed nodes with normalized gaps and smart scrollbars.
  ![Text Label Feature](img/XIS_Label_1.jpeg)
### 🧰 Image, Mask & File Nodes
- **XIS_ImagePuzzle**: Advanced image stitching with four layout types (left-main, right-main, top-main, bottom-main), supporting multiple main images with proper spacing and alignment.
  ![XIS_ImagePuzzle Interface](img/XIS_ImagePuzzle_1.jpeg)
  ![XIS_ImagePuzzle Workflow Example](img/XIS_ImagePuzzle_2.jpeg)
  
- **XIS_ImageAdjustAndBlend**: Adjust brightness, contrast, saturation, hue, RGB gains, and blend modes with optional mask/background mixes.
- **XIS_CropImage**: Crop via masks, invert masks on demand, and fill backgrounds with color or padding.
- **XIS_ResizeImageOrMask**: Resize with multiple strategies (force, aspect ratio, canvas limit) plus interpolation choices and shrink/expand toggles.
- **XIS_ReorderImageMaskGroups**: Reorder or insert up to five image-mask pairs so compositing stays precise.
- **XIS_InvertMask**: Swap mask polarity quickly with a toggle.
- **XIS_ImageMaskMirror**: Mirror image/mask sets along X or Y axes to keep symmetric compositions aligned.
- **PSD Layer Extract** / **XIS_ReorderImages**: Pull layers out of PSDs and rearrange batches for downstream blending.

### ⚙️ Data & Utility Helpers
- **XIS_ShapeData**: Gather shape properties (position, rotation, scale, skew, color) for predictive pipelines.
- **XIS_IsThereAnyData**: Guard inputs across ints, floats, booleans, and supply fallbacks when signals are missing.
- **CreatePointsString**: Encode six frame/intensity pairs into a keyword-friendly shorthand for repeatable sequences.
- **XIS_FromListGet1…**: Extract single masks, images, latents, conditioning, models, colors, strings, ints, or floats from lists.
- **XIS_ResizeToDivisible**: Snap dimensions to the nearest divisible grid for downstream requirements.

---

## Acknowledgements

- The interactive canvas uses [Konva](https://konvajs.org/) under the hood; thanks to the Konva contributors for the full-featured 2D drawing API.
- The one-click cutout leverages [BiRefNet](https://github.com/tamzi/bi-ref-net) (thanks to the original authors and the community contributions such as the tin2tin/2D_Asset_Generator project) along with `kornia` and `timm` for the preprocessing/backbone support.
- Any additional inspiration for layer handling came from community-built ComfyUI extensions—big thanks to the ComfyUI and custom node author communities for keeping the ecosystem so vibrant.

---

## Contact & Resources

**Workflow Sharing**
https://openart.ai/workflows/profile/grinlau?tab=workflows&sort=latest

**Bilibili Space**
https://space.bilibili.com/123365258

**Contact Information**
QQ: 3861103314
Email: grinlau18@gmail.com

---

## Contributing

Contributions are welcome! Feel free to:
- Submit pull requests with new features or bug fixes
- Open issues for suggestions or problems

## License

This project is licensed under the [MIT License](LICENSE).

---
