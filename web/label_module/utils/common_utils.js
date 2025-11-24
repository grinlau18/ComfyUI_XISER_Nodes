export function ensureNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, min, max) {
    const number = ensureNumber(value, min);
    if (number < min) return min;
    if (number > max) return max;
    return number;
}

export function clamp01(value) {
    return clamp(value, 0, 1);
}

export function hasText(value) {
    return typeof value === "string" && value.trim().length > 0;
}
