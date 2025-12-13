# GTSfM Timeline Visualization
## Short Presentation Guide

---

## Overview: 38 Events in 4 Phases

| Phase | Events | What Happens | Animation |
|-------|--------|--------------|-----------|
| **1. Fade In** | 1-19 | Raw clusters appear | Opacity 0→1, camera focuses |
| **2. Leaf Promotion** | 20-30 | Single clusters transform | Rise + glow effect |
| **3. Parent Merge** | 31-37 | Multiple clusters combine | Converge + fade |
| **4. Final Merge** | 38 | Complete building | Grand convergence + 360° |

---

## Phase 1: Fade In (Events 1-19)

### What's Happening
Each `ba_output` cluster represents a **partial reconstruction** from a subset of images. In this phase, all 19 raw reconstructions appear on screen.

### Event-by-Event Breakdown

| Event | Cluster | Description |
|-------|---------|-------------|
| 1 | `C_4/C_4_1/C_4_1_1/C_4_1_1_1/ba_output` | Deepest C_4 branch cluster |
| 2 | `C_4/C_4_1/C_4_1_1/C_4_1_1_1/C_4_1_1_1_2/ba_output` | Even deeper C_4 cluster |
| 3 | `C_4/C_4_1/C_4_1_1/C_4_1_1_2/C_4_1_1_2_2/ba_output` | Another deep C_4 cluster |
| 4 | `C_1/ba_output` | **C_1's portion** of Gerrard Hall |
| 5 | `C_4/C_4_1/ba_output` | C_4_1's reconstruction |
| 6 | `C_3/ba_output` | **C_3's portion** of the building |
| 7 | `C_4/C_4_1/C_4_1_2/ba_output` | C_4_1_2 cluster |
| 8 | `ba_output` (root) | **Root's direct reconstruction** |
| 9 | `C_1/C_1_2/ba_output` | C_1's second child |
| 10 | `C_4/ba_output` | **C_4's direct reconstruction** |
| 11 | `C_4/C_4_1/C_4_1_1/C_4_1_1_2/ba_output` | Deep C_4 cluster |
| 12 | `C_4/C_4_1/C_4_1_1/C_4_1_1_2/C_4_1_1_2_1/ba_output` | Deepest level |
| 13 | `C_4/C_4_1/C_4_1_1/C_4_1_1_1/C_4_1_1_1_1/ba_output` | Another deepest level |
| 14 | `C_4/C_4_2/C_4_2_1/ba_output` | C_4_2 branch |
| 15 | `C_4/C_4_2/C_4_2_2/ba_output` | C_4_2 branch |
| 16 | `C_4/C_4_2/ba_output` | C_4_2's reconstruction |
| 17 | `C_2/ba_output` | **C_2's portion** of the building |
| 18 | `C_1/C_1_1/ba_output` | C_1's first child |
| 19 | `C_4/C_4_1/C_4_1_1/ba_output` | C_4_1_1's reconstruction |

### Why We Zoom In
**Camera focuses on each new cluster** as it appears because:
- Clusters are scattered across different spatial positions
- Without zoom, new clusters might appear too small to notice
- Helps viewer understand which part of the building each cluster represents

### Visual Result
After Event 19: **19 point clouds visible** - scattered fragments representing different portions of Gerrard Hall.

---

## Phase 2: Leaf Promotion (Events 20-30)

### What's Happening
**Leaf clusters** (those with no children) don't need to merge anything - they simply "promote" their `ba_output` to become their `merged` output.

### The Concept
```
Leaf cluster has:
- ba_output/ (raw reconstruction)
- merged/    (same as ba_output, just promoted)

Since there are no children to combine, merged = ba_output
```

### Event-by-Event Breakdown

| Event | Path | What Transforms |
|-------|------|-----------------|
| 20 | `C_2/merged` | C_2/ba_output → C_2/merged |
| 21 | `C_1/C_1_1/merged` | Leaf in C_1 branch promotes |
| 22 | `C_4/C_4_2/C_4_2_1/merged` | Deep C_4_2 leaf promotes |
| 23 | `C_4/C_4_2/C_4_2_2/merged` | Another C_4_2 leaf |
| 24 | `C_4/C_4_1/C_4_1_2/merged` | C_4_1 branch leaf |
| 25 | `C_4/C_4_1/C_4_1_1/C_4_1_1_2/C_4_1_1_2_1/merged` | Deepest leaf |
| 26 | `C_1/C_1_2/merged` | C_1's second child promotes |
| 27 | `C_4/C_4_1/C_4_1_1/C_4_1_1_2/C_4_1_1_2_2/merged` | Deep leaf |
| 28 | `C_4/C_4_1/C_4_1_1/C_4_1_1_1/C_4_1_1_1_2/merged` | Deep leaf |
| 29 | `C_3/merged` | **C_3 promotes** (important top-level) |
| 30 | `C_4/C_4_1/C_4_1_1/C_4_1_1_1/C_4_1_1_1_1/merged` | Last deep leaf |

### Animation Explained
1. **ba_output cluster rises** - moves upward in Y-axis
2. **Glow effect** - visual emphasis on transformation
3. **ba_output fades out** - old version disappears
4. **merged fades in** - new version appears at higher level

### Why We Zoom In
**Camera follows the rising cluster** because:
- The promotion involves vertical movement
- Without tracking, the cluster would move out of frame
- Shows the transformation from "raw" to "merged" status

### Visual Result
After Event 30: **Leaf ba_outputs replaced** by their merged versions at slightly higher vertical positions.

---

## Phase 3: Parent Merge (Events 31-37)

### What's Happening
**Parent clusters** have children. They combine:
1. Their own `ba_output`
2. All their children's `merged` results

### The Merge Formula
```
parent/merged = parent/ba_output + child_1/merged + child_2/merged + ...
```

### Event-by-Event Breakdown

| Event | Path | Formula | Inputs |
|-------|------|---------|--------|
| 31 | `C_4/C_4_1/C_4_1_1/C_4_1_1_2/merged` | ba_output + C_4_1_1_2_1/merged + C_4_1_1_2_2/merged | 3 clusters |
| 32 | `C_1/merged` | **C_1/ba_output + C_1_1/merged + C_1_2/merged** | 3 clusters |
| 33 | `C_4/C_4_1/C_4_1_1/C_4_1_1_1/merged` | ba_output + C_4_1_1_1_1/merged + C_4_1_1_1_2/merged | 3 clusters |
| 34 | `C_4/C_4_2/merged` | **C_4_2/ba_output + C_4_2_1/merged + C_4_2_2/merged** | 3 clusters |
| 35 | `C_4/C_4_1/C_4_1_1/merged` | ba_output + C_4_1_1_1/merged + C_4_1_1_2/merged | 3 clusters |
| 36 | `C_4/C_4_1/merged` | **ba_output + C_4_1_1/merged + C_4_1_2/merged** | 3 clusters |
| 37 | `C_4/merged` | **C_4/ba_output + C_4_1/merged + C_4_2/merged** | 3 clusters |

### Animation Explained
1. **All input clusters rise simultaneously** - coordinated upward movement
2. **Clusters converge toward center** - move horizontally toward merge point
3. **Inputs fade out** - old clusters disappear as they reach center
4. **Output fades in** - new combined cluster appears

### Why We Zoom In
**Camera frames all merging clusters** because:
- Need to show multiple clusters moving together
- Convergence animation is the key visual element
- Zoom level adjusts to fit all inputs in frame

### Visual Result
After Event 37: **Only 5 clusters remain**:
- `ba_output` (root)
- `C_1/merged`
- `C_2/merged`
- `C_3/merged`
- `C_4/merged`

---

## Phase 4: Final Merge (Event 38)

### What's Happening
The **grand finale** - all 5 top-level clusters combine into the complete Gerrard Hall reconstruction.

### The Final Formula
```
merged (ROOT) = ba_output + C_1/merged + C_2/merged + C_3/merged + C_4/merged
```

### Animation Sequence
1. **All 5 clusters rise** - dramatic upward movement
2. **Grand convergence** - clusters move toward center simultaneously
3. **Inputs fade out** - 5 clusters disappear
4. **Complete building appears** - full Gerrard Hall point cloud
5. **Camera zooms in** - close-up of final result
6. **360° rotation** - showcase the complete reconstruction

### Why We Zoom In (Special Case)
**Camera behavior is different for Event 38**:
- First: Wide view to capture all 5 clusters converging
- Then: **Dramatic zoom in** to show the complete building
- Finally: **360° rotation** to showcase from all angles

This creates a **cinematic finale** that emphasizes:
- The achievement of combining all fragments
- The quality of the final reconstruction
- A satisfying conclusion to the visualization

### Visual Result
**Complete Gerrard Hall** - all 19 original clusters merged into one unified point cloud.

---

## Summary: Camera Focus Strategy

| Phase | Camera Behavior | Reason |
|-------|-----------------|--------|
| **Fade In** | Focus on new cluster | Show where it appears in space |
| **Leaf Promotion** | Track rising cluster | Follow the transformation |
| **Parent Merge** | Frame all inputs | Show convergence animation |
| **Final Merge** | Wide → Zoom → Rotate | Cinematic showcase |

### The Key Insight
**Dynamic camera focus** solves the problem of:
- Clusters being spread across 3D space
- Animations happening at different locations
- Need to show both individual detail and overall context

Without dynamic focus, the viewer would either:
- See everything too small to understand
- Miss animations happening off-screen

---

## Quick Demo Script

### Opening (30 sec)
"This visualization shows how GTSfM builds Gerrard Hall from image clusters. We'll see 38 events in 4 phases."

### Phase 1 (1 min)
"First, 19 raw reconstructions appear - each from a different set of images. Watch how the camera focuses on each new cluster."
*[Play Events 1-19]*

### Phase 2 (1 min)
"Now leaf clusters - those without children - promote to merged status. They rise up and transform."
*[Play Events 20-30]*

### Phase 3 (1 min)
"Parent clusters combine their ba_output with their children's merged results. Watch how multiple clusters converge."
*[Play Events 31-37]*

### Phase 4 (30 sec)
"The finale - all 5 remaining clusters merge into the complete Gerrard Hall, followed by a 360-degree rotation."
*[Play Event 38]*

### Closing (30 sec)
"This visualization makes GTSfM's hierarchical process visible - from 19 fragments to 1 complete building in 38 steps."

---

## Appendix: Complete Event Table

| Event | Phase | Type | Path | Inputs |
|-------|-------|------|------|--------|
| 1 | 1 | Fade In | C_4/.../C_4_1_1_1/ba_output | - |
| 2 | 1 | Fade In | C_4/.../C_4_1_1_1_2/ba_output | - |
| 3 | 1 | Fade In | C_4/.../C_4_1_1_2_2/ba_output | - |
| 4 | 1 | Fade In | C_1/ba_output | - |
| 5 | 1 | Fade In | C_4/C_4_1/ba_output | - |
| 6 | 1 | Fade In | C_3/ba_output | - |
| 7 | 1 | Fade In | C_4/C_4_1/C_4_1_2/ba_output | - |
| 8 | 1 | Fade In | ba_output | - |
| 9 | 1 | Fade In | C_1/C_1_2/ba_output | - |
| 10 | 1 | Fade In | C_4/ba_output | - |
| 11 | 1 | Fade In | C_4/.../C_4_1_1_2/ba_output | - |
| 12 | 1 | Fade In | C_4/.../C_4_1_1_2_1/ba_output | - |
| 13 | 1 | Fade In | C_4/.../C_4_1_1_1_1/ba_output | - |
| 14 | 1 | Fade In | C_4/C_4_2/C_4_2_1/ba_output | - |
| 15 | 1 | Fade In | C_4/C_4_2/C_4_2_2/ba_output | - |
| 16 | 1 | Fade In | C_4/C_4_2/ba_output | - |
| 17 | 1 | Fade In | C_2/ba_output | - |
| 18 | 1 | Fade In | C_1/C_1_1/ba_output | - |
| 19 | 1 | Fade In | C_4/C_4_1/C_4_1_1/ba_output | - |
| 20 | 2 | Leaf Promotion | C_2/merged | C_2/ba_output |
| 21 | 2 | Leaf Promotion | C_1/C_1_1/merged | C_1/C_1_1/ba_output |
| 22 | 2 | Leaf Promotion | C_4/.../C_4_2_1/merged | ba_output |
| 23 | 2 | Leaf Promotion | C_4/.../C_4_2_2/merged | ba_output |
| 24 | 2 | Leaf Promotion | C_4/.../C_4_1_2/merged | ba_output |
| 25 | 2 | Leaf Promotion | C_4/.../C_4_1_1_2_1/merged | ba_output |
| 26 | 2 | Leaf Promotion | C_1/C_1_2/merged | ba_output |
| 27 | 2 | Leaf Promotion | C_4/.../C_4_1_1_2_2/merged | ba_output |
| 28 | 2 | Leaf Promotion | C_4/.../C_4_1_1_1_2/merged | ba_output |
| 29 | 2 | Leaf Promotion | C_3/merged | C_3/ba_output |
| 30 | 2 | Leaf Promotion | C_4/.../C_4_1_1_1_1/merged | ba_output |
| 31 | 3 | Parent Merge | C_4/.../C_4_1_1_2/merged | 3 inputs |
| 32 | 3 | Parent Merge | C_1/merged | 3 inputs |
| 33 | 3 | Parent Merge | C_4/.../C_4_1_1_1/merged | 3 inputs |
| 34 | 3 | Parent Merge | C_4/C_4_2/merged | 3 inputs |
| 35 | 3 | Parent Merge | C_4/.../C_4_1_1/merged | 3 inputs |
| 36 | 3 | Parent Merge | C_4/C_4_1/merged | 3 inputs |
| 37 | 3 | Parent Merge | C_4/merged | 3 inputs |
| 38 | 4 | Final Merge | merged | 5 inputs |


