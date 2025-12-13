# GTSfM Gerrard Hall Visualization Project

## Project Overview

This project creates interactive 3D visualizations of the GTSfM (Georgia Tech Structure from Motion) pipeline's hierarchical reconstruction process for Gerrard Hall at UNC Chapel Hill.

## What is GTSfM?

GTSfM is a Structure from Motion pipeline that:
1. Takes multiple images of a scene/building
2. Divides images into clusters for parallel processing
3. Reconstructs 3D point clouds from each cluster
4. Hierarchically merges clusters into a complete reconstruction

## The Visualization Goal

Show **how** GTSfM reconstructs buildings by visualizing:
- Individual cluster reconstructions (`ba_output` folders)
- The hierarchical merge process (`merged` folders)
- The final complete reconstruction

---

## Three Visualization Modes

### 1. Slab View (`slab.html`) - **Frank's Vision**
**Purpose:** Implement Frank's "sheets of glass" concept

**How it works:**
- Clusters arranged on horizontal layers (levels)
- Level 0 (bottom) = leaf clusters (smallest reconstructions)
- Top level = final merged reconstruction
- Animation shows clusters **rising upward** and merging

**Best for:** Understanding the temporal merge process

### 2. Hierarchy View (`hierarchy.html`)
**Purpose:** Show the tree structure of cluster relationships

**How it works:**
- Traditional tree layout (root at top, leaves at bottom)
- Parent-child relationships clearly visible
- Step through merge events

**Best for:** Understanding cluster relationships

### 3. Puzzle View (`puzzle.html`)
**Purpose:** Show spatial assembly of the building

**How it works:**
- Clusters positioned at their real 3D coordinates
- Animation shows pieces coming together
- Final result is the assembled building

**Best for:** Understanding spatial relationships

---

## Directory Structure (GTSfM Output)

```
data/gerrard-hall/results/
├── ba_output/              ← Root-level bundle adjustment
├── merged/                 ← FINAL complete reconstruction
├── C_1/                    ← Cluster 1
│   ├── ba_output/          ← C_1's direct reconstruction
│   ├── merged/             ← C_1/ba_output + children merged
│   ├── C_1_1/              ← Sub-cluster
│   │   ├── ba_output/
│   │   └── merged/
│   └── C_1_2/
│       ├── ba_output/
│       └── merged/
├── C_2/                    ← Cluster 2 (leaf - no children)
│   ├── ba_output/
│   └── merged/
├── C_3/                    ← Cluster 3 (leaf)
├── C_4/                    ← Cluster 4 (deepest hierarchy)
│   ├── ba_output/
│   ├── merged/
│   ├── C_4_1/
│   │   ├── C_4_1_1/
│   │   │   └── (deeper...)
│   │   └── C_4_1_2/
│   └── C_4_2/
│       ├── C_4_2_1/
│       └── C_4_2_2/
└── cluster_tree.pkl        ← Serialized tree structure
```

---

## Key Concepts

### ba_output vs merged

| Folder | Contains | Created By |
|--------|----------|------------|
| `ba_output/` | Direct reconstruction from cluster's images | Bundle Adjustment |
| `merged/` | Combined result of `ba_output` + all child `merged` folders | Hierarchical Merge |

### Merge Formula

For any cluster `X` with children:
```
X/merged = X/ba_output + X/child_1/merged + X/child_2/merged + ...
```

For leaf clusters (no children):
```
X/merged = X/ba_output
```

### Root Merge (Final)
```
merged = ba_output + C_1/merged + C_2/merged + C_3/merged + C_4/merged
```

---

## Animation Timeline

### Phase 1: ba_output folders appear (Events 1-19)
- All cluster `ba_output` reconstructions appear
- These are the raw outputs from bundle adjustment
- Order is random (simulating async compute cluster)

### Phase 2: merged folders appear (Events 20-38)
- Child `merged` folders must appear before parent
- Simulates hierarchical merging
- Root `merged` is always LAST (Event 38)

---

## Technical Implementation

### Files Structure
```
js/
├── data-loader.js           # Loads point clouds from GTSfM output
├── layout-engine-slab.js    # Positions clusters for Slab View
├── animation-engine-slab.js # Handles merge animations
├── main-slab.js             # Main application for Slab View
└── (similar files for hierarchy and puzzle views)
```

### Key Technologies
- **Three.js** - 3D rendering
- **WebGL** - Hardware-accelerated graphics
- **ES6 Modules** - Modern JavaScript

---

## What We're Working On

### Current Focus: Animation Timing

We're building a simulation that:
1. Assigns timestamps to each `ba_output` folder (random order)
2. Assigns timestamps to each `merged` folder (respecting dependencies)
3. Ensures root `merged` always has highest timestamp

### Dependency Rule
A parent `merged` can only appear AFTER all its child `merged` folders have appeared.

### Random Async Simulation
Within dependency constraints, order is randomized to simulate parallel processing on a compute cluster.

---

## Files to Review

1. **`docs/slab-view-system-design.md`** - Detailed Slab View design
2. **`data/gerrard-hall/results/notebook.ipynb`** - Python simulation of timeline
3. **`js/data-loader.js`** - How we load GTSfM output
4. **`js/layout-engine-slab.js`** - How we position clusters
5. **`js/animation-engine-slab.js`** - How we animate merges

---

## Running the Visualization

```bash
cd gerrard-hall-v3
python3 -m http.server 8086
# Open http://localhost:8086
```

Choose from:
- **Slab View** - Frank's sheets of glass concept
- **Hierarchy View** - Tree structure
- **Puzzle View** - Spatial assembly

---

## Questions for Discussion

1. Should `ba_output` folders be visualized separately from `merged`?
2. What animation duration feels right for merge events?
3. Should camera follow the action or stay fixed?
4. How to best show the "combining" of point clouds during merge?


