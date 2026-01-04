# Timeline Centroid View: Presentation Slides

## How to Present
1. Open `http://localhost:8087/timeline-centroid.html` for live demo
2. Screen record the full visualization for video clips
3. Use the diagrams below as visual aids

---

# SLIDE 1: The Problem & Our Solution

## What We Had Before (Timeline View)

```
BEFORE: Hierarchical Layout (Position = Folder Depth)

     Level 4:              merged (root)
                              │
     Level 3:    ┌────────────┼────────────┐
              C_1/merged  C_2/merged  C_4/merged
                              │
     Level 2:         ┌───────┴───────┐
                   children...    children...
                              │
     Level 1:    ba_output  ba_output  ba_output
                 (leaves appear at bottom)
```

### Issues with the Old Approach:
| Problem | Impact |
|---------|--------|
| **Arbitrary positioning** | Clusters placed by folder depth, NOT by actual 3D location |
| **No spatial meaning** | Top/bottom of building could be anywhere on screen |
| **Confusing merges** | Clusters moved "up" in hierarchy, not toward each other |
| **Abstract visualization** | Didn't show HOW the building is reconstructed |

---

## Our Solution: Centroid-Based Positioning

```
NOW: Geometric Layout (Position = Actual 3D Centroid)

         ●ROOT (0, 90)
          ba_output
             │
    ┌────────┼────────┐
    │        │        │
●C_1      ●C_2  ●C_3      ●C_4
(-120,50) (-36,12)(36,12) (120,50)
    │                      │
 ┌──┴──┐              ┌────┴────┐
 │     │              │         │
●C_1_1 ●C_1_2      ●C_4_1    ●C_4_2
                      │
                 ┌────┴────┐
              (deeper branches...)
                      │
              ●●●● (deepest leaves)
              (0,-96) to (96,-96)
```

### Key Innovation:
- **X position** = Left/Right of building
- **Y position** = Top/Bottom of building  
- **Clusters that are close in 3D space appear close on screen**

---

# SLIDE 2: How the Visualization Works

## Phase 1: Cluster Appearance (Events 1-19)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                      ●ROOT                                  │
│                    (fades in)                               │
│                                                             │
│        ●C_1                              ●C_4               │
│      (appears)                         (appears)            │
│                                                             │
│    ●     ●        ●C_2  ●C_3        ●        ●              │
│   C_1_1 C_1_2   (center)           C_4_1   C_4_2            │
│                                                             │
│                                    ●  ●  ●  ●               │
│                                   (deepest leaves)          │
│                                                             │
│  Camera: Zooms to each cluster as it appears                │
└─────────────────────────────────────────────────────────────┘

19 ba_output clusters appear at their GEOMETRIC positions
Each represents a portion of the building (top, bottom, left, right)
```

## Phase 2: Transition (Events 20-30)
- **Instant swap**: ba_output → merged (no visible change)
- **Purpose**: Internal state update only
- **Duration**: ~0.1 seconds each (skipped visually)

## Phase 3: Merging (Events 31-37)

```
BEFORE MERGE:                    DURING MERGE:
                                 
    ●A        ●B                     ●A ──→ ●M ←── ●B
                                     
    ●C                               ●C ──→ ●M
                                     
                                 Clusters IMPLODE toward
                                 their combined centroid

AFTER MERGE:

         ●M
    (merged cluster
     appears at center)
```

### Merge Animation Details:
| Step | Duration | What Happens |
|------|----------|--------------|
| 1 | 0-70% of 3s | Input clusters move toward merge point |
| 2 | 70-100% | Input clusters fade out as they converge |
| 3 | After | Merged cluster fades in at target position |

## Phase 4: Final Assembly (Event 38)

```
        ●ROOT                              
           ↓                               
    ┌──────┼──────┐                        
    ↓      ↓      ↓                        
   ●C_1   ●C_2   ●C_4         →→→      ████████████
    ↓      ↓      ↓                    █ GERRARD  █
    └──────┴──────┘                    █   HALL   █
                                       ████████████
   All clusters                        Complete
   converge to (0,0)                   Building!
```

---

# SLIDE 3: Design Decisions & Future Plans

## Why We Made These Choices

### 1. Hard-Coded Positions (Not Dynamic)
```
POSITIONS = {
    'ba_output':     { x: 0,    y: 90  },   // ROOT - top center
    'C_1/ba_output': { x: -120, y: 50  },   // LEFT branch
    'C_4/ba_output': { x: 120,  y: 50  },   // RIGHT branch
    ...
}
```
**Reason**: GTSfM output folders don't encode 3D positions. We manually mapped the hierarchy to a logical 2D layout that reflects the building structure.

### 2. Removed "Lock In" Animation
**Before**: 11 events (20-30) showed a glow effect for leaf promotions
**Now**: These happen instantly (~0.1s)
**Reason**: Leaf promotion doesn't change visible data - it's just internal bookkeeping. Animating it confused viewers.

### 3. Slower Animations with Completion Check
```javascript
// Only advance when animation is DONE
if (!isAnimating && time - lastStep > delay) {
    step(1);
}
```
**Reason**: Previous version moved to next event before current animation finished. Now we wait for:
- Animation to complete
- Additional viewing time (1-3 seconds)

---

## Future Enhancement: Alpha Blending

### Current State
```
Cluster A ──┐
            ├──→ Merged Cluster (appears after fade)
Cluster B ──┘
```
Clusters fade out, then merged cluster fades in.

### Planned: Point-Level Interpolation
```
Cluster A points: ●●●●●●●●
                   ╲  ╲  ╲  ╲
                    ╲  ╲  ╲  ╲
                     ↘  ↘  ↘  ↘
Merged points:         ●●●●●●●●●●●●
                     ↗  ↗  ↗  ↗
                    ╱  ╱  ╱  ╱
                   ╱  ╱  ╱  ╱
Cluster B points: ●●●●●●●●
```

### Alpha Blending Features (To Be Added):
| Feature | Description |
|---------|-------------|
| **Motion trails** | Points leave a fading trail as they move |
| **Point interpolation** | Each point animates from source → target position |
| **Keyframe blending** | Smooth transition between cluster states |
| **Flock effect** | Points move with organic, coordinated motion |

### Reference Implementation
We have a working prototype in `timeline-alpha.html` that demonstrates:
- Point-level morphing between clusters
- Alpha blending with motion trails
- Smooth cubic easing for natural movement

**Next Step**: Integrate alpha blending INTO the centroid view for the best of both worlds.

---

## Summary

| Aspect | Old Timeline View | New Centroid View |
|--------|-------------------|-------------------|
| **Positioning** | By folder depth | By 3D centroid |
| **Meaning** | Abstract hierarchy | Spatial building layout |
| **Merging** | Move "up" levels | Implode toward center |
| **Camera** | Fixed or manual | Auto-tracks action |
| **Animations** | Fast, overlapping | Slow, complete before next |
| **Leaf promotions** | Animated glow | Instant (skipped) |

---

## Demo Video Timestamps

When recording the visualization, capture these moments:

| Time | What to Show | Narration |
|------|--------------|-----------|
| 0:00-0:30 | Phase 1 clusters appearing | "Each cluster appears at its geometric position" |
| 0:30-0:40 | Transition phase (fast) | "Internal state updates happen instantly" |
| 0:40-1:30 | Merge animations | "Watch clusters converge and combine" |
| 1:30-2:00 | Final assembly | "Everything comes together at the center" |
| 2:00-2:15 | Final rotation | "The complete Gerrard Hall reconstruction" |

---

## Appendix: Position Reference

### All 19 ba_output Cluster Positions

| Cluster | X | Y | Location |
|---------|---|---|----------|
| ba_output | 0 | 90 | TOP CENTER |
| C_1/ba_output | -120 | 50 | LEFT |
| C_1/C_1_1/ba_output | -150 | 12 | LEFT BOTTOM |
| C_1/C_1_2/ba_output | -90 | 12 | LEFT BOTTOM |
| C_2/ba_output | -36 | 12 | CENTER LEFT |
| C_3/ba_output | 36 | 12 | CENTER RIGHT |
| C_4/ba_output | 120 | 50 | RIGHT |
| C_4/C_4_1/ba_output | 84 | 12 | RIGHT |
| C_4/C_4_2/ba_output | 168 | 12 | FAR RIGHT |
| C_4/C_4_1/C_4_1_1/ba_output | 48 | -24 | RIGHT LOWER |
| C_4/C_4_1/C_4_1_2/ba_output | 108 | -24 | RIGHT LOWER |
| C_4/C_4_2/C_4_2_1/ba_output | 144 | -24 | FAR RIGHT LOWER |
| C_4/C_4_2/C_4_2_2/ba_output | 192 | -24 | FAR RIGHT LOWER |
| C_4/C_4_1/C_4_1_1/C_4_1_1_1/ba_output | 18 | -60 | DEEP RIGHT |
| C_4/C_4_1/C_4_1_1/C_4_1_1_2/ba_output | 78 | -60 | DEEP RIGHT |
| C_4/.../C_4_1_1_1_1/ba_output | 0 | -96 | DEEPEST |
| C_4/.../C_4_1_1_1_2/ba_output | 36 | -96 | DEEPEST |
| C_4/.../C_4_1_1_2_1/ba_output | 60 | -96 | DEEPEST |
| C_4/.../C_4_1_1_2_2/ba_output | 96 | -96 | DEEPEST |

