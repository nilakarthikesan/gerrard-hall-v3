#!/usr/bin/env python3
"""
Visualize Gerrard Hall reconstruction with Rerun
This creates a beautiful interactive 3D visualization of the point clouds and cameras.

Install: pip install rerun-sdk numpy
Run: python visualize_with_rerun.py
"""

import numpy as np
import os
from pathlib import Path

try:
    import rerun as rr
except ImportError:
    print("Please install rerun-sdk: pip install rerun-sdk")
    exit(1)

def parse_points3d(filepath):
    """Parse COLMAP-style points3D.txt file"""
    points = []
    colors = []
    
    with open(filepath, 'r') as f:
        for line in f:
            if line.startswith('#') or not line.strip():
                continue
            parts = line.strip().split()
            if len(parts) >= 7:
                # POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[]
                x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                r, g, b = int(parts[4]), int(parts[5]), int(parts[6])
                points.append([x, y, z])
                colors.append([r, g, b])
    
    return np.array(points), np.array(colors, dtype=np.uint8)

def parse_cameras(filepath):
    """Parse COLMAP-style cameras.txt file"""
    cameras = {}
    
    with open(filepath, 'r') as f:
        for line in f:
            if line.startswith('#') or not line.strip():
                continue
            parts = line.strip().split()
            if len(parts) >= 5:
                # CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]
                cam_id = int(parts[0])
                model = parts[1]
                width = int(parts[2])
                height = int(parts[3])
                params = [float(p) for p in parts[4:]]
                cameras[cam_id] = {
                    'model': model,
                    'width': width,
                    'height': height,
                    'params': params
                }
    
    return cameras

def parse_images(filepath):
    """Parse COLMAP-style images.txt file"""
    images = []
    
    with open(filepath, 'r') as f:
        lines = f.readlines()
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith('#') or not line:
            i += 1
            continue
        
        parts = line.split()
        if len(parts) >= 10:
            # IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME
            img_id = int(parts[0])
            qw, qx, qy, qz = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            tx, ty, tz = float(parts[5]), float(parts[6]), float(parts[7])
            cam_id = int(parts[8])
            name = parts[9]
            
            images.append({
                'id': img_id,
                'quat': [qx, qy, qz, qw],  # Rerun uses [x, y, z, w] format
                'translation': [tx, ty, tz],
                'camera_id': cam_id,
                'name': name
            })
        
        i += 1
        # Skip the next line (2D points) if it exists
        if i < len(lines) and not lines[i].startswith('#'):
            i += 1
    
    return images

def quaternion_to_rotation_matrix(q):
    """Convert quaternion [x, y, z, w] to rotation matrix"""
    x, y, z, w = q
    
    return np.array([
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w],
        [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w],
        [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y]
    ])

def get_camera_position(image):
    """Get camera position in world coordinates from image data"""
    R = quaternion_to_rotation_matrix(image['quat'])
    t = np.array(image['translation'])
    # Camera position = -R^T * t
    cam_pos = -R.T @ t
    return cam_pos

def main():
    base_path = Path(__file__).parent / "data" / "gerrard-hall" / "results"
    output_file = Path(__file__).parent / "gerrard_hall_rerun.rrd"
    
    # Initialize Rerun - save to file instead of spawning viewer
    rr.init("Gerrard Hall Reconstruction")
    rr.save(str(output_file))
    print(f"Recording to: {output_file}")
    
    # Log coordinate system info
    rr.log("world", rr.ViewCoordinates.RIGHT_HAND_Y_UP, static=True)
    
    # Define cluster paths and colors for visualization
    cluster_paths = [
        ("ba_output", [255, 100, 100]),  # Red - final merged
        ("C_1/ba_output", [100, 255, 100]),  # Green
        ("C_2/ba_output", [100, 100, 255]),  # Blue
        ("C_3/ba_output", [255, 255, 100]),  # Yellow
        ("C_4/ba_output", [255, 100, 255]),  # Magenta
    ]
    
    # Also check for leaf clusters
    for i in range(1, 5):
        for j in range(1, 5):
            path = f"C_{i}/C_{i}_{j}/ba_output"
            if (base_path / path / "points3D.txt").exists():
                # Generate a unique color based on indices
                hue = ((i-1) * 4 + (j-1)) / 16.0
                r = int(255 * (0.5 + 0.5 * np.sin(hue * 2 * np.pi)))
                g = int(255 * (0.5 + 0.5 * np.sin(hue * 2 * np.pi + 2.094)))
                b = int(255 * (0.5 + 0.5 * np.sin(hue * 2 * np.pi + 4.189)))
                cluster_paths.append((path, [r, g, b]))
    
    print("Loading point clouds and cameras...")
    
    # Process each cluster
    for cluster_path, default_color in cluster_paths:
        points_file = base_path / cluster_path / "points3D.txt"
        cameras_file = base_path / cluster_path / "cameras.txt"
        images_file = base_path / cluster_path / "images.txt"
        
        if not points_file.exists():
            continue
        
        print(f"  Loading {cluster_path}...")
        
        # Parse and log point cloud
        points, colors = parse_points3d(points_file)
        
        if len(points) > 0:
            # Use actual colors from the reconstruction
            rr.log(
                f"clusters/{cluster_path.replace('/', '_')}/points",
                rr.Points3D(
                    positions=points,
                    colors=colors,
                    radii=0.05  # Bigger point size for visibility
                )
            )
            print(f"    Logged {len(points)} points")
        
        # Parse and log cameras
        if cameras_file.exists() and images_file.exists():
            cameras = parse_cameras(cameras_file)
            images = parse_images(images_file)
            
            for img in images:
                cam_pos = get_camera_position(img)
                
                # Log camera position as a point
                rr.log(
                    f"clusters/{cluster_path.replace('/', '_')}/cameras/{img['name']}",
                    rr.Points3D(
                        positions=[cam_pos],
                        colors=[[0, 255, 255]],  # Cyan for cameras
                        radii=0.03
                    )
                )
            
            print(f"    Logged {len(images)} cameras")
    
    # Also load the final merged result with larger points
    final_points_file = base_path / "ba_output" / "points3D.txt"
    if final_points_file.exists():
        points, colors = parse_points3d(final_points_file)
        rr.log(
            "final_reconstruction/points",
            rr.Points3D(
                positions=points,
                colors=colors,
                radii=0.015
            )
        )
        print(f"  Final reconstruction: {len(points)} points")
    
    print(f"\n✅ Visualization saved to: {output_file}")
    print("\nTo view, either:")
    print("  1. Open in browser: https://rerun.io/viewer")
    print("     Then drag and drop the .rrd file into the viewer")
    print("  2. Or install viewer: pip install rerun-sdk[native]")
    print("     Then run: rerun gerrard_hall_rerun.rrd")

if __name__ == "__main__":
    main()
