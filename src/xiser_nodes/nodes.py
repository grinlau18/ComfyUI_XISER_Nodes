import comfy

class XIS_PromptsWithSwitches:
    @classmethod
    def INPUT_TYPES(cls):
        input_config = {}
        for i in range(1, 6):
            input_config[f"prompt_{i}"] = ("STRING", {"default": "", "multiline": True})
            input_config[f"enable_{i}"] = ("BOOLEAN", {"default": True})

        return {
            "required": {},
            "optional": input_config
        }

    RETURN_TYPES = ("STRING",)
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "process_prompts"
    CATEGORY = "XISER_Nodes"

    def process_prompts(self, **kwargs):
        prompts = []
        for i in range(1, 6):
            prompt_key = f"prompt_{i}"
            enable_key = f"enable_{i}"
            prompt = kwargs.get(prompt_key, "")
            enable = kwargs.get(enable_key, True)
            if enable and prompt.strip() != "":
                prompts.append(prompt)

        if len(prompts) == 0:
            prompts.append("000")

        return (prompts,)

class XIS_Float_Slider:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider"}),
            }
        }
    RETURN_TYPES = ("FLOAT",)
    FUNCTION = "process_float_slider"
    CATEGORY = "XISER_Nodes"

    def process_float_slider(self, **kwargs):
        value = kwargs.get("value", 0.0)
        return (value,)

class XIS_INT_Slider:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1, "display": "slider"}),
            }
        }
    RETURN_TYPES = ("INT",)
    FUNCTION = "process_int_slider"
    CATEGORY = "XISER_Nodes"

    def process_int_slider(self, **kwargs):
        value = kwargs.get("value", 0)
        return (value,)



# 节点类映射
NODE_CLASS_MAPPINGS = {
    "XIS_PromptsWithSwitches": XIS_PromptsWithSwitches,
    "XIS_Float_Slider": XIS_Float_Slider,
    "XIS_INT_Slider": XIS_INT_Slider,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "XIS_PromptsWithSwitches": "Prompts With Switches",
    "XIS_Float_Slider": "Float Slider",
    "XIS_INT_Slider": "INT Slider",
}