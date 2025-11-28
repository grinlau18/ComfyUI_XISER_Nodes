import json
from .constants import logger


def parse_image_state_payload(raw_value):
    """Parse frontend-provided image_state payload into a list of dict entries."""
    if raw_value is None:
        return []
    data = raw_value
    if isinstance(raw_value, str):
        raw_value = raw_value.strip()
        if not raw_value:
            return []
        try:
            data = json.loads(raw_value)
        except Exception:
            return []
    if isinstance(data, dict):
        images = data.get("images")
        if isinstance(images, list):
            return [entry for entry in images if isinstance(entry, dict)]
        return []
    if isinstance(data, list):
        return [entry for entry in data if isinstance(entry, dict)]
    return []


def validate_image_order(order, num_images):
    """Validate image order, ensuring all indices are valid."""
    if not isinstance(order, list) or len(order) != num_images or len(set(order)) != num_images:
        logger.warning(f"Invalid image order: {order}, generating default [0...{num_images-1}]")
        return list(range(num_images))
    valid_order = [idx for idx in order if isinstance(idx, int) and 0 <= idx < num_images]
    if len(valid_order) != num_images or len(set(valid_order)) != num_images:
        logger.warning(f"Incomplete or duplicate image order: {order}, generating default [0...{num_images-1}]")
        return list(range(num_images))
    logger.debug(f"Validated order: {valid_order}")
    return valid_order


def hash_from_entry(entry):
    if not entry or not isinstance(entry, dict):
        return None
    return entry.get("content_hash") or entry.get("contentHash")
