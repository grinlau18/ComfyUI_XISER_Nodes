# src/xiser_nodes/list_processing.py
from .utils import logger

class GetSingleFromListMeta(type):
    """
    元类，用于从列表中获取单个元素。
    """
    def __new__(cls, name, bases, attrs):
        attrs.update({
            "RETURN_TYPES": (attrs["TYPE"].upper(),),
            "CATEGORY": "XISER_Nodes/Data_Processing",
            "FUNCTION": "get_one",
            "INPUT_IS_LIST": True,
            "INPUT_TYPES": classmethod(lambda cls: {
                "required": {
                    "list": (attrs["TYPE"].upper(), {"forceInput": True}),
                    "index": ("INT", {"default": 0, "min": -2147483648})
                }
            })
        })

        def get_one(self, list, index):
            if not list:
                raise ValueError("Input list cannot be empty")
            index = index[0] % len(list)
            return (list[index],)

        attrs["get_one"] = get_one
        return super().__new__(cls, name, bases, attrs)

class XIS_FromListGet1Mask(metaclass=GetSingleFromListMeta): TYPE = "MASK"
class XIS_FromListGet1Image(metaclass=GetSingleFromListMeta): TYPE = "IMAGE"
class XIS_FromListGet1Latent(metaclass=GetSingleFromListMeta): TYPE = "LATENT"
class XIS_FromListGet1Cond(metaclass=GetSingleFromListMeta): TYPE = "CONDITIONING"
class XIS_FromListGet1Model(metaclass=GetSingleFromListMeta): TYPE = "MODEL"
class XIS_FromListGet1Color(metaclass=GetSingleFromListMeta): TYPE = "COLOR"
class XIS_FromListGet1String(metaclass=GetSingleFromListMeta): TYPE = "STRING"
class XIS_FromListGet1Int(metaclass=GetSingleFromListMeta): TYPE = "INT"
class XIS_FromListGet1Float(metaclass=GetSingleFromListMeta): TYPE = "FLOAT"

NODE_CLASS_MAPPINGS = {
    "XIS_FromListGet1Mask": XIS_FromListGet1Mask,
    "XIS_FromListGet1Image": XIS_FromListGet1Image,
    "XIS_FromListGet1Latent": XIS_FromListGet1Latent,
    "XIS_FromListGet1Cond": XIS_FromListGet1Cond,
    "XIS_FromListGet1Model": XIS_FromListGet1Model,
    "XIS_FromListGet1Color": XIS_FromListGet1Color,
    "XIS_FromListGet1String": XIS_FromListGet1String,
    "XIS_FromListGet1Int": XIS_FromListGet1Int,
    "XIS_FromListGet1Float": XIS_FromListGet1Float,
}

