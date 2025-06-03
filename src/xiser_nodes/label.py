import logging
from typing import Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("XIS_Label")

logger.info("Registering XIS_Label node")

class XIS_Label:
    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """Returns the input types for the node."""
        return {}  # No input parameters

    RETURN_TYPES = ()  # No return values
    FUNCTION = "execute"  # Node execution function
    CATEGORY = "XISER_Nodes/UIControl"  # Node category

    def execute(self) -> None:
        """Executes the node, performing no functional logic."""
        logger.debug("Executing XIS_Label node")
        pass

    def onNodeCreated(self) -> None:
        """Initializes node properties on creation."""
        logger.debug("Creating XIS_Label node")
        self.properties = self.properties or {}
        self.properties["textData"] = (
            '<p style="font-size:20px;color:#FFFFFF;">小贴纸</p>'
            '<p style="font-size:12px;color:#999999;">使用右键菜单编辑文字</p>'
        )
        self.color = "#333355"  # Default dark gray

# Node mappings for registration
NODE_CLASS_MAPPINGS = {
    "XIS_Label": XIS_Label,
}