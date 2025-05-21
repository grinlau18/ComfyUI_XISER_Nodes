import os
import aiohttp
from aiohttp import web
import folder_paths
import logging

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