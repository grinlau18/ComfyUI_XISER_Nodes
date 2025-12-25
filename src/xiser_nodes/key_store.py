"""Simple encrypted API key storage under ComfyUI/user."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Optional

from cryptography.fernet import Fernet


class KeyStore:
    """Manages encrypted API keys in the ComfyUI user directory."""

    def __init__(self, base_dir: Optional[Path] = None) -> None:
        self.base_dir = base_dir or self._default_base_dir()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.key_file = self.base_dir / "key.bin"
        self.store_file = self.base_dir / "keys.json"
        self._fernet = Fernet(self._load_or_create_master())
        raw = self._load_store()
        self._keys: Dict[str, str] = raw if isinstance(raw, dict) else {}

    def _default_base_dir(self) -> Path:
        here = Path(__file__).resolve()
        comfy_root = here.parents[4]  # .../ComfyUI
        return comfy_root / "user" / "API_keys"

    def _load_or_create_master(self) -> bytes:
        if self.key_file.exists():
            return self.key_file.read_bytes()
        key = Fernet.generate_key()
        self.key_file.write_bytes(key)
        return key

    def _load_store(self) -> Dict:
        if not self.store_file.exists():
            return {}
        try:
            data = json.loads(self.store_file.read_text("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save_store(self) -> None:
        self.store_file.write_text(json.dumps(self._keys, ensure_ascii=False, indent=2), "utf-8")

    def list_profiles(self) -> Dict[str, bool]:
        return {name: True for name in self._keys.keys()}

    def save_key(self, profile: str, api_key: str, overwrite: bool = False) -> None:
        if not overwrite and profile in self._keys:
            raise ValueError("Profile already exists; set overwrite=True to replace.")
        token = self._fernet.encrypt(api_key.encode("utf-8")).decode("utf-8")
        self._keys[profile] = token
        self._save_store()

    def delete_key(self, profile: str) -> None:
        if profile in self._keys:
            del self._keys[profile]
            self._save_store()

    def get_key(self, profile: str) -> Optional[str]:
        token = self._keys.get(profile)
        if not token:
            return None
        try:
            return self._fernet.decrypt(token.encode("utf-8")).decode("utf-8")
        except Exception:
            return None



KEY_STORE = KeyStore()
