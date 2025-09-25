"""
XIS_CoordinatePath.py

Custom node for ComfyUI to generate coordinate paths based on control points.
Supports linear and curve path modes with configurable segments.
"""

import torch
import numpy as np
from typing import List, Dict, Any

class XIS_CoordinatePath:
    """
    A custom node for generating coordinate paths based on control points.
    """

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        """
        Defines the input types for the node.

        Returns:
            Dict[str, Any]: Input types configuration.
        """
        return {
            "required": {
                "width": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),
                "height": ("INT", {"default": 512, "min": 1, "max": 4096, "step": 1}),
                "path_segments": ("INT", {"default": 5, "min": 2, "max": 100, "step": 1}),
                "path_mode": (
                    "COMBO",
                    {
                        "default": "linear",
                        "options": ["linear", "curve"]
                    }
                ),
                "path_canvas": ("WIDGET", {}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "FLOAT", "FLOAT", "LIST", "LIST")
    RETURN_NAMES = ("x_coordinate", "y_coordinate", "x_percent", "y_percent", "x_list", "y_list")
    FUNCTION = "execute"
    CATEGORY = "XISER_Nodes/Other"
    OUTPUT_IS_LIST = (True, True, True, True, False, False)

    def calculate_linear_path(self, control_points: List[Dict[str, float]], segments: int) -> List[Dict[str, float]]:
        """
        Calculate linear path coordinates between control points.

        Args:
            control_points: List of control points with x, y coordinates
            segments: Number of segments to generate

        Returns:
            List of coordinate points
        """
        if len(control_points) < 2:
            return []

        path_coords = []
        
        # Calculate total path length
        total_length = 0
        segment_lengths = []
        for i in range(len(control_points) - 1):
            x1, y1 = control_points[i]["x"], control_points[i]["y"]
            x2, y2 = control_points[i + 1]["x"], control_points[i + 1]["y"]
            length = np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
            total_length += length
            segment_lengths.append(length)

        if total_length == 0:
            return []

        # Generate evenly spaced points along the entire path
        for i in range(segments):
            # Calculate target distance along the path
            target_distance = (i / (segments - 1)) * total_length if segments > 1 else 0
            
            # Find which segment contains this distance
            current_distance = 0
            segment_index = 0
            for j, seg_length in enumerate(segment_lengths):
                if current_distance + seg_length >= target_distance:
                    segment_index = j
                    break
                current_distance += seg_length
            
            # Calculate position within the segment
            segment_remaining = target_distance - current_distance
            segment_start = control_points[segment_index]
            segment_end = control_points[segment_index + 1]
            
            if segment_lengths[segment_index] > 0:
                t = segment_remaining / segment_lengths[segment_index]
            else:
                t = 0
            
            t = max(0, min(1, t))
            x = segment_start["x"] + t * (segment_end["x"] - segment_start["x"])
            y = segment_start["y"] + t * (segment_end["y"] - segment_start["y"])
            
            path_coords.append({"x": x, "y": y})

        return path_coords

    def calculate_curve_path(self, control_points: List[Dict[str, float]], segments: int) -> List[Dict[str, float]]:
        """
        Calculate curve path coordinates using Catmull-Rom spline with arc-length parameterization.
        Points are distributed evenly along the total curve length.

        Args:
            control_points: List of control points with x, y coordinates
            segments: Number of segments to generate

        Returns:
            List of coordinate points
        """
        if len(control_points) < 2:
            return []

        # 使用改进的虚拟端点生成算法，与前端保持一致
        points = control_points.copy()
        if len(points) == 2:
            # 对于2个点，创建更平滑的虚拟端点
            p0 = {"x": points[0]["x"] - 0.2 * (points[1]["x"] - points[0]["x"]),
                  "y": points[0]["y"] - 0.2 * (points[1]["y"] - points[0]["y"])}
            p3 = {"x": points[1]["x"] + 0.2 * (points[1]["x"] - points[0]["x"]),
                  "y": points[1]["y"] + 0.2 * (points[1]["y"] - points[0]["y"])}
            points = [p0, points[0], points[1], p3]
        elif len(points) == 3:
            # 对于3个点，创建更平滑的虚拟端点
            p0 = {"x": points[0]["x"] - 0.15 * (points[1]["x"] - points[0]["x"]),
                  "y": points[0]["y"] - 0.15 * (points[1]["y"] - points[0]["y"])}
            p4 = {"x": points[2]["x"] + 0.15 * (points[2]["x"] - points[1]["x"]),
                  "y": points[2]["y"] + 0.15 * (points[2]["y"] - points[1]["y"])}
            points = [p0, points[0], points[1], points[2], p4]
        else:
            # 对于4个及以上控制点，添加平滑的虚拟端点
            p0 = {"x": points[0]["x"] - 0.1 * (points[1]["x"] - points[0]["x"]),
                  "y": points[0]["y"] - 0.1 * (points[1]["y"] - points[0]["y"])}
            p_end = {"x": points[-1]["x"] + 0.1 * (points[-1]["x"] - points[-2]["x"]),
                    "y": points[-1]["y"] + 0.1 * (points[-1]["y"] - points[-2]["y"])}
            points = [p0] + points + [p_end]

        # 计算曲线段数量
        num_curve_segments = len(points) - 3
        if num_curve_segments <= 0:
            return []

        # 计算曲线总长度
        total_length = self.calculate_curve_length(points)
        if total_length == 0:
            return []

        path_coords = []

        # 基于弧长均匀分布点
        for i in range(segments):
            # 计算目标弧长（从0到总长度）
            if segments == 1:
                target_arc_length = total_length / 2  # 单个点放在中间
            else:
                target_arc_length = (i / (segments - 1)) * total_length

            # 找到对应的曲线段和参数t
            segment_index, t = self.find_t_for_arc_length(points, target_arc_length)

            # 生成曲线点
            point = self.catmull_rom(points, segment_index, t)
            path_coords.append(point)

        return path_coords

    def catmull_rom(self, points: List[Dict[str, float]], segment_index: int, t: float) -> Dict[str, float]:
        """
        Calculate Catmull-Rom spline point.

        Args:
            points: Control points
            segment_index: Current segment index
            t: Parameter (0-1)

        Returns:
            Point coordinates
        """
        # Ensure segment_index is within valid bounds
        if segment_index < 0 or segment_index + 3 >= len(points):
            # Return midpoint of the valid segment range as fallback
            valid_segment = min(max(0, segment_index), len(points) - 4)
            p0 = points[valid_segment]
            p1 = points[valid_segment + 1]
            p2 = points[valid_segment + 2]
            p3 = points[valid_segment + 3]
        else:
            p0 = points[segment_index]
            p1 = points[segment_index + 1]
            p2 = points[segment_index + 2]
            p3 = points[segment_index + 3]

        # Catmull-Rom basis matrix
        t2 = t * t
        t3 = t2 * t

        x = 0.5 * ((2 * p1["x"]) +
                  (-p0["x"] + p2["x"]) * t +
                  (2 * p0["x"] - 5 * p1["x"] + 4 * p2["x"] - p3["x"]) * t2 +
                  (-p0["x"] + 3 * p1["x"] - 3 * p2["x"] + p3["x"]) * t3)

        y = 0.5 * ((2 * p1["y"]) +
                  (-p0["y"] + p2["y"]) * t +
                  (2 * p0["y"] - 5 * p1["y"] + 4 * p2["y"] - p3["y"]) * t2 +
                  (-p0["y"] + 3 * p1["y"] - 3 * p2["y"] + p3["y"]) * t3)

        return {"x": x, "y": y}

    def calculate_curve_length(self, points: List[Dict[str, float]], samples_per_segment: int = 100) -> float:
        """
        Calculate the total length of the Catmull-Rom curve.

        Args:
            points: Control points with virtual endpoints
            samples_per_segment: Number of samples per curve segment for length calculation

        Returns:
            Total curve length
        """
        num_curve_segments = len(points) - 3
        if num_curve_segments <= 0:
            return 0.0

        total_length = 0.0

        for seg in range(num_curve_segments):
            # Sample points along the curve segment
            prev_point = self.catmull_rom(points, seg, 0.0)
            for j in range(1, samples_per_segment + 1):
                t = j / samples_per_segment
                current_point = self.catmull_rom(points, seg, t)

                # Calculate distance between consecutive points
                dx = current_point["x"] - prev_point["x"]
                dy = current_point["y"] - prev_point["y"]
                segment_length = np.sqrt(dx * dx + dy * dy)
                total_length += segment_length

                prev_point = current_point

        return total_length

    def find_t_for_arc_length(self, points: List[Dict[str, float]], target_arc_length: float,
                            samples_per_segment: int = 100) -> tuple:
        """
        Find the curve segment and parameter t that corresponds to a given arc length.

        Args:
            points: Control points with virtual endpoints
            target_arc_length: Target arc length along the curve
            samples_per_segment: Number of samples per segment for length calculation

        Returns:
            Tuple of (segment_index, t) that corresponds to the target arc length
        """
        num_curve_segments = len(points) - 3
        if num_curve_segments <= 0:
            return (0, 0.0)

        accumulated_length = 0.0

        for seg in range(num_curve_segments):
            # Calculate segment length
            prev_point = self.catmull_rom(points, seg, 0.0)
            segment_length = 0.0

            for j in range(1, samples_per_segment + 1):
                t = j / samples_per_segment
                current_point = self.catmull_rom(points, seg, t)

                dx = current_point["x"] - prev_point["x"]
                dy = current_point["y"] - prev_point["y"]
                segment_length += np.sqrt(dx * dx + dy * dy)
                prev_point = current_point

            # Check if target is within this segment
            if accumulated_length + segment_length >= target_arc_length:
                # Find exact t within this segment
                remaining_length = target_arc_length - accumulated_length

                prev_point = self.catmull_rom(points, seg, 0.0)
                current_length = 0.0

                for j in range(1, samples_per_segment + 1):
                    t = j / samples_per_segment
                    current_point = self.catmull_rom(points, seg, t)

                    dx = current_point["x"] - prev_point["x"]
                    dy = current_point["y"] - prev_point["y"]
                    step_length = np.sqrt(dx * dx + dy * dy)

                    if current_length + step_length >= remaining_length:
                        # Interpolate t based on remaining distance
                        if step_length > 0:
                            t_interp = (remaining_length - current_length) / step_length
                            final_t = (j - 1) / samples_per_segment + t_interp / samples_per_segment
                        else:
                            final_t = (j - 1) / samples_per_segment

                        return (seg, max(0.0, min(1.0, final_t)))

                    current_length += step_length
                    prev_point = current_point

                # If we reach here, return the end of the segment
                return (seg, 1.0)

            accumulated_length += segment_length

        # If target length exceeds total length, return last segment end
        return (num_curve_segments - 1, 1.0)


    def execute(self, width: int, height: int, path_segments: int, path_mode: str, path_canvas: Dict[str, Any]) -> tuple:
        """
        Execute the path coordinate generation.

        Args:
            width: Canvas width
            height: Canvas height
            path_segments: Number of path segments to generate
            path_mode: Path mode ("linear" or "curve")
            path_canvas: Canvas data containing control points

        Returns:
            tuple: (x_coordinates, y_coordinates) as lists
        """
        control_points = path_canvas.get("control_points", [])
        
        # Set default control points if none exist
        if not control_points or len(control_points) < 2:
            control_points = [
                {"x": 125.0 / width, "y": 125.0 / height},
                {"x": 387.0 / width, "y": 387.0 / height}
            ]

        # Calculate path coordinates
        if path_mode == "linear":
            path_coords = self.calculate_linear_path(control_points, path_segments)
        else:  # curve mode
            path_coords = self.calculate_curve_path(control_points, path_segments)

        if not path_coords:
            # Return default coordinates if no valid path
            default_x = [int(width / 2)] * path_segments
            default_y = [int(height / 2)] * path_segments
            default_x_percent = [50.0] * path_segments  # 50% center position
            default_y_percent = [50.0] * path_segments  # 50% center position
            default_x_list = [0.0] * path_segments  # Center at origin (0, 0)
            default_y_list = [0.0] * path_segments  # Center at origin (0, 0)
            return (default_x, default_y, default_x_percent, default_y_percent, default_x_list, default_y_list)

        # Convert normalized coordinates to pixel coordinates based on width and height
        # Ensure coordinates are within valid range [0, width-1] and [0, height-1]
        x_coords = [max(0, min(width - 1, int(round(coord["x"] * width)))) for coord in path_coords]
        y_coords = [max(0, min(height - 1, int(round(coord["y"] * height)))) for coord in path_coords]

        # Calculate percentage coordinates (0-100 range)
        x_percent = [coord["x"] * 100.0 for coord in path_coords]
        y_percent = [coord["y"] * 100.0 for coord in path_coords]

        # Calculate normalized list coordinates (origin at center, range -0.5 to 0.5)
        # X: -0.5 (left) to 0.5 (right), Y: -0.5 (top) to 0.5 (bottom)
        # 画面中心坐标对应的xy值为0和0，左上角对应-0.5和-0.5，右下角对应0.5和0.5
        # 注意：Y轴方向与前端Konva画布保持一致（向下为正）
        x_list = [(coord["x"] - 0.5) for coord in path_coords]  # 将0-1范围转换为-0.5到0.5
        y_list = [(coord["y"] - 0.5) for coord in path_coords]  # 保持Y轴方向一致（向下为正）

        return (x_coords, y_coords, x_percent, y_percent, x_list, y_list)

NODE_CLASS_MAPPINGS = {
    "XIS_CoordinatePath": XIS_CoordinatePath
}