# GTSfM Merge Tree Structure - Gerrard Hall

## Complete Merge Tree Diagram

```
                                        ┌──────────────────────────────────────────┐
                                        │              merged (ROOT)               │
                                        │     = Final Complete Gerrard Hall        │
                                        │                EVENT 38                  │
                                        └──────────────────────────────────────────┘
                                                          │
            ┌─────────────────┬─────────────────┬─────────┴─────────┬─────────────────┐
            │                 │                 │                   │                 │
            ▼                 ▼                 ▼                   ▼                 ▼
      ┌───────────┐    ┌───────────┐    ┌───────────┐       ┌───────────┐    ┌───────────┐
      │ ba_output │    │C_1/merged │    │C_2/merged │       │C_3/merged │    │C_4/merged │
      │  (root)   │    │           │    │   LEAF    │       │   LEAF    │    │           │
      └───────────┘    └───────────┘    └───────────┘       └───────────┘    └───────────┘
           │                 │                │                   │                 │
        (leaf)              │             (leaf)              (leaf)               │
                            │                                                      │
          ┌─────────────────┼─────────────────┐               ┌────────────────────┼────────────────────┐
          │                 │                 │               │                    │                    │
          ▼                 ▼                 ▼               ▼                    ▼                    ▼
    ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐       ┌───────────┐       ┌───────────┐
    │C_1/       │    │C_1/C_1_1/ │    │C_1/C_1_2/ │    │C_4/       │       │C_4/C_4_1/ │       │C_4/C_4_2/ │
    │ba_output  │    │merged     │    │merged     │    │ba_output  │       │merged     │       │merged     │
    └───────────┘    └───────────┘    └───────────┘    └───────────┘       └───────────┘       └───────────┘
        (leaf)           │                │               (leaf)                 │                   │
                         │                │                                      │                   │
                   ┌─────┘                └─────┐               ┌─────────────────┼───────────────────┼─────────────────┐
                   │                           │               │                 │                   │                 │
                   ▼                           ▼               ▼                 ▼                   ▼                 ▼
             ┌───────────┐               ┌───────────┐   ┌───────────┐    ┌───────────┐       ┌───────────┐    ┌───────────┐
             │C_1_1/     │               │C_1_2/     │   │C_4_1/     │    │C_4_1_1/   │       │C_4_1_2/   │    │C_4_2/     │
             │ba_output  │               │ba_output  │   │ba_output  │    │merged     │       │merged     │    │ba_output  │
             └───────────┘               └───────────┘   └───────────┘    └───────────┘       └───────────┘    └───────────┘
                (leaf)                      (leaf)          (leaf)             │                  │               (leaf)
                                                                               │                  │
                                                                    ┌──────────┴──────────┐      │
                                                                    │                     │      │
                                                                    ▼                     ▼      │
                                                              ┌───────────┐         ┌───────────┐│
                                                              │C_4_1_1/   │         │C_4_1_1/   ││
                                                              │ba_output  │         │C_4_1_1_1/ ││
                                                              └───────────┘         │merged     ││
                                                                 (leaf)             └───────────┘│
                                                                                          │      │
                                                                    (continues deeper...) │      │
                                                                                          │      │
                                                              ┌───────────────────────────┘      │
                                                              │                                  │
                                                              ▼                                  │
                                                    (C_4_1_1_1 subtree)                         │
                                                                                                 │
                                                              ┌──────────────────────────────────┘
                                                              │
                                                              ▼
                                                    ┌───────────────────┐
                                                    │   C_4_2 subtree   │
                                                    │  (C_4_2_1, C_4_2_2)│
                                                    └───────────────────┘
```

---

## Merge Formulas

### Root Level
```
merged = ba_output + C_1/merged + C_2/merged + C_3/merged + C_4/merged
```

### C_1 Branch
```
C_1/merged = C_1/ba_output + C_1/C_1_1/merged + C_1/C_1_2/merged

C_1/C_1_1/merged = C_1/C_1_1/ba_output  (leaf)
C_1/C_1_2/merged = C_1/C_1_2/ba_output  (leaf)
```

### C_2 & C_3 (Leaves)
```
C_2/merged = C_2/ba_output  (no children)
C_3/merged = C_3/ba_output  (no children)
```

### C_4 Branch (Complex)
```
C_4/merged = C_4/ba_output + C_4/C_4_1/merged + C_4/C_4_2/merged

C_4/C_4_1/merged = C_4/C_4_1/ba_output + C_4/C_4_1/C_4_1_1/merged + C_4/C_4_1/C_4_1_2/merged

C_4/C_4_1/C_4_1_1/merged = ... (continues deeper)

C_4/C_4_2/merged = C_4/C_4_2/ba_output + C_4/C_4_2/C_4_2_1/merged + C_4/C_4_2/C_4_2_2/merged
```

---

## Event Dependencies

### What Must Complete Before Each Merge

| Merged Folder | Dependencies (must complete first) |
|---------------|-----------------------------------|
| `merged` (root) | C_1/merged, C_2/merged, C_3/merged, C_4/merged |
| `C_1/merged` | C_1/C_1_1/merged, C_1/C_1_2/merged |
| `C_2/merged` | (none - leaf) |
| `C_3/merged` | (none - leaf) |
| `C_4/merged` | C_4/C_4_1/merged, C_4/C_4_2/merged |
| `C_4/C_4_1/merged` | C_4/C_4_1/C_4_1_1/merged, C_4/C_4_1/C_4_1_2/merged |
| `C_4/C_4_2/merged` | C_4/C_4_2/C_4_2_1/merged, C_4/C_4_2/C_4_2_2/merged |
| ... | (pattern continues) |

---

## Cluster Statistics

### By Depth Level

| Depth | Clusters | Examples |
|-------|----------|----------|
| 0 | 1 | `merged` (root) |
| 1 | 5 | `ba_output`, `C_1/merged`, `C_2/merged`, `C_3/merged`, `C_4/merged` |
| 2 | 8+ | `C_1/C_1_1/merged`, `C_4/C_4_1/merged`, etc. |
| 3+ | many | `C_4/C_4_1/C_4_1_1/merged`, etc. |

### Totals
- **19 ba_output folders** (direct reconstructions)
- **19 merged folders** (combined reconstructions)
- **38 total events** in animation

---

## Animation Order Constraint

```
For any parent P with children C1, C2, ..., Cn:

timestamp(P/merged) > max(timestamp(C1/merged), timestamp(C2/merged), ..., timestamp(Cn/merged))
```

This ensures:
1. All children complete before parent starts
2. Root `merged` is always the LAST event (Event 38)
3. Leaf clusters can appear in any order (no dependencies)

---

## Visual Layer Mapping (Slab View)

| Level | Y Position | Clusters |
|-------|------------|----------|
| 0 (bottom) | -50 | Deepest leaves |
| 1 | -25 | First merge results |
| 2 | 0 | Second merge results |
| 3 | +25 | Top-level cluster merges |
| 4 (top) | +50 | Root `merged` |

Animation shows clusters **rising from Level 0 to Level 4**, merging at each transition.


