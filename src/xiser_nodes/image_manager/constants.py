import logging
import os
import folder_paths

LOG_LEVEL = "error"  # Set to error to reduce logging noise
LOGGER_NAME = "XISER_ImageManager"

logger = logging.getLogger(LOGGER_NAME)
logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.INFO))


def get_base_output_dir():
    """Return the base directory for XIS_ImageManager outputs."""
    return os.path.join(folder_paths.get_output_directory(), "xis_image_manager")
