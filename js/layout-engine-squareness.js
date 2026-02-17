import * as THREE from 'three';

/**
 * Squareness-Based Recursive Rectangle Layout Engine
 * 
 * Uses the squareness algorithm from the Frank/ChatGPT PDF:
 *   S = min(w,h) / max(w,h)  -- 1 for a perfect square, 0 for a thin strip
 * 
 * Key design: Only LEAF nodes get spatial positions. Merged (non-leaf) nodes
 * get a mergeTargetPosition (center of children) and mergeRegion (bounding rect)
 * used solely during merge animations. This prevents the overlap caused by
 * nesting parent and child point clouds in the same space.
 */
export class SquarenessLayoutEngine {
    constructor(clusters) {
        this.clusters = clusters;
        this.rootCluster = clusters.get('merged');
        this.bounds = null;
        this.treeNodes = [];

        // Fraction of each tile reserved as padding between siblings
        this.PADDING_FRAC = 0.06;
    }

    // ----------------------------------------------------------------
    // Core squareness math (unchanged from the PDF algorithm)
    // ----------------------------------------------------------------

    /**
     * Enumerate all compositions of n (ordered partitions into positive ints).
     * For n<=7 there are at most 2^(n-1) = 64 compositions.
     */
    compositions(n) {
        const result = [];
        const generate = (remaining, current) => {
            if (remaining === 0) { result.push([...current]); return; }
            for (let first = 1; first <= remaining; first++) {
                current.push(first);
                generate(remaining - first, current);
                current.pop();
            }
        };
        generate(n, []);
        return result;
    }

    /**
     * Squareness of one row that has m tiles inside a W x H rectangle
     * partitioned into n equal-area tiles.
     *   row height = H * m / n,  tile width = W / m
     *   rho = (H * m^2) / (W * n),  S = min(rho, 1/rho)
     */
    squarenessForRow(W, H, n, m) {
        const rho = (H * m * m) / (W * n);
        return rho <= 1 ? rho : 1 / rho;
    }

    /**
     * Find the best equal-area partition of W x H into n sub-rectangles.
     * Brute-forces all compositions for both rows-first and cols-first.
     */
    bestEqualAreaPartition(W, H, n) {
        if (n === 1) {
            return {
                squareness: Math.min(W, H) / Math.max(W, H),
                mode: 'rows', groups: [1],
                layout: [{ x: 0, y: 0, w: W, h: H }]
            };
        }

        const allComps = this.compositions(n);
        let bestS = -1, bestMode = 'rows', bestGroups = null;

        for (const ms of allComps) {
            const s = Math.min(...ms.map(m => this.squarenessForRow(W, H, n, m)));
            if (s > bestS) { bestS = s; bestMode = 'rows'; bestGroups = ms; }
        }
        for (const ms of allComps) {
            const s = Math.min(...ms.map(m => this.squarenessForRow(H, W, n, m)));
            if (s > bestS) { bestS = s; bestMode = 'cols'; bestGroups = ms; }
        }

        const layout = this.buildTiles(W, H, bestMode, bestGroups, n);
        return { squareness: bestS, mode: bestMode, groups: bestGroups, layout };
    }

    /** Convert a partition description into concrete { x, y, w, h } tiles. */
    buildTiles(W, H, mode, groups, n) {
        const tiles = [];
        if (mode === 'rows') {
            let yOff = 0;
            for (const m of groups) {
                const rowH = H * m / n;
                const tileW = W / m;
                for (let i = 0; i < m; i++)
                    tiles.push({ x: i * tileW, y: yOff, w: tileW, h: rowH });
                yOff += rowH;
            }
        } else {
            let xOff = 0;
            for (const m of groups) {
                const colW = W * m / n;
                const tileH = H / m;
                for (let i = 0; i < m; i++)
                    tiles.push({ x: xOff, y: i * tileH, w: colW, h: tileH });
                xOff += colW;
            }
        }
        return tiles;
    }

    // ----------------------------------------------------------------
    // Layout computation
    // ----------------------------------------------------------------

    computeLayout() {
        if (!this.rootCluster) {
            console.error("No root cluster (merged) found!");
            return;
        }

        console.log("\n=== COMPUTING SQUARENESS LAYOUT ===");

        // 1. Build tree from root
        const visited = new Set();
        const buildTree = (cluster, depth = 0) => {
            if (!cluster || visited.has(cluster.path)) return null;
            visited.add(cluster.path);
            const node = { cluster, depth, children: [] };
            this.treeNodes.push(node);
            for (const child of (cluster.children || [])) {
                const cn = buildTree(child, depth + 1);
                if (cn) node.children.push(cn);
            }
            return node;
        };
        const rootNode = buildTree(this.rootCluster);

        // 2. Count leaves and determine a good root rectangle size.
        const leaves = this.treeNodes.filter(n => n.children.length === 0);
        const leafCount = leaves.length;
        const maxRadius = Math.max(
            ...Array.from(this.clusters.values())
                .filter(c => c.radius > 0).map(c => c.radius), 1
        );

        // We want each leaf tile large enough so the point cloud (diameter ~2*maxRadius)
        // fits comfortably with margin.  Total area ~ leafCount * (tileSize)^2.
        const tileSize = maxRadius * 3;
        const totalArea = tileSize * tileSize * leafCount * 1.6;
        const aspect = 16 / 9;
        const ROOT_H = Math.sqrt(totalArea / aspect);
        const ROOT_W = ROOT_H * aspect;

        console.log(`Leaves: ${leafCount}, maxRadius: ${maxRadius.toFixed(1)}`);
        console.log(`Root rect: ${ROOT_W.toFixed(0)} x ${ROOT_H.toFixed(0)}`);

        // 3. Recursively assign tiles to LEAVES only.
        //    Non-leaf nodes do NOT get a tile; they get mergeTargetPosition later.
        const rootRect = { x: -ROOT_W / 2, y: -ROOT_H / 2, w: ROOT_W, h: ROOT_H };
        this.assignLeafTiles(rootNode, rootRect);

        // 4. For each non-leaf (merged) node, compute mergeTargetPosition and mergeRegion
        //    from the bounding box of its descendant leaves.
        this.computeMergePositions(rootNode);

        // 5. Set Three.js positions and scales on all clusters
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        for (const node of this.treeNodes) {
            const c = node.cluster;
            const isLeaf = node.children.length === 0;

            if (isLeaf && c.rect) {
                // Leaf: place at center of its tile
                const cx = c.rect.x + c.rect.w / 2;
                const cy = c.rect.y + c.rect.h / 2;
                c.hierarchyPosition = new THREE.Vector3(cx, cy, 0);
                c.group.position.copy(c.hierarchyPosition);
                c.group.rotation.x = Math.PI;

                // Scale so the point cloud fits within the tile
                if (c.radius > 0) {
                    const fitDim = Math.min(c.rect.w, c.rect.h) * 0.44;
                    c.fitScale = fitDim / c.radius;
                    c.group.scale.setScalar(c.fitScale);
                }

                minX = Math.min(minX, c.rect.x);
                maxX = Math.max(maxX, c.rect.x + c.rect.w);
                minY = Math.min(minY, c.rect.y);
                maxY = Math.max(maxY, c.rect.y + c.rect.h);

                console.log(`  LEAF ${c.path}: tile=(${c.rect.x.toFixed(0)},${c.rect.y.toFixed(0)} ${c.rect.w.toFixed(0)}x${c.rect.h.toFixed(0)}) scale=${c.fitScale.toFixed(3)}`);

            } else if (!isLeaf) {
                // Merged node: use precomputed merge position
                const pos = c.mergeTargetPosition;
                const reg = c.mergeRegion;
                if (pos) {
                    c.hierarchyPosition = pos.clone();
                    c.group.position.copy(c.hierarchyPosition);
                    c.group.rotation.x = Math.PI;

                    // Scale so the merged point cloud fits the region that held all its children
                    if (c.radius > 0 && reg) {
                        const fitDim = Math.min(reg.w, reg.h) * 0.44;
                        c.fitScale = fitDim / c.radius;
                        c.group.scale.setScalar(c.fitScale);
                    }

                    console.log(`  MERGE ${c.path}: pos=(${pos.x.toFixed(0)},${pos.y.toFixed(0)}) region=${reg ? (reg.w.toFixed(0)+'x'+reg.h.toFixed(0)) : 'N/A'}`);
                }
            }
        }

        // 6. Bounds for camera fitting
        this.bounds = {
            minX, maxX, minY, maxY,
            width: maxX - minX + 40,
            height: maxY - minY + 40
        };

        // Hide orphans
        for (const [path] of this.clusters) {
            if (!visited.has(path)) this.clusters.get(path).group.visible = false;
        }

        console.log(`Bounds: ${this.bounds.width.toFixed(0)} x ${this.bounds.height.toFixed(0)}`);
        console.log("=== SQUARENESS LAYOUT COMPLETE ===\n");
    }

    /**
     * Recursively assign tiles to LEAF nodes only.
     * Non-leaf nodes just pass their allocated rectangle down to children.
     */
    assignLeafTiles(node, rect) {
        const isLeaf = node.children.length === 0;

        if (isLeaf) {
            // This leaf gets the whole rectangle (with padding already applied by parent)
            node.cluster.rect = { ...rect };
            return;
        }

        // Non-leaf: subdivide rect among children
        const n = node.children.length;
        const partition = this.bestEqualAreaPartition(rect.w, rect.h, n);
        const pad = Math.min(rect.w, rect.h) * this.PADDING_FRAC;

        console.log(`  Partition ${node.cluster.path}: n=${n} mode=${partition.mode} groups=[${partition.groups}] S=${partition.squareness.toFixed(3)}`);

        for (let i = 0; i < n; i++) {
            const tile = partition.layout[i];
            const childRect = {
                x: rect.x + tile.x + pad / 2,
                y: rect.y + tile.y + pad / 2,
                w: tile.w - pad,
                h: tile.h - pad
            };
            this.assignLeafTiles(node.children[i], childRect);
        }
    }

    /**
     * For each non-leaf node, compute:
     *   mergeTargetPosition  – center of all descendant leaves (where the merged
     *                          result will appear during the merge animation)
     *   mergeRegion           – bounding rect of all descendant leaves (used to
     *                          scale the merged point cloud)
     */
    computeMergePositions(node) {
        if (node.children.length === 0) {
            // Leaf – already has rect
            return;
        }

        // Recurse first so children have their data ready
        for (const child of node.children) this.computeMergePositions(child);

        // Collect bounding rect of all descendant leaf tiles
        const leafRects = [];
        const gatherLeaves = (n) => {
            if (n.children.length === 0 && n.cluster.rect) {
                leafRects.push(n.cluster.rect);
            }
            for (const ch of n.children) gatherLeaves(ch);
        };
        gatherLeaves(node);

        if (leafRects.length === 0) return;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const r of leafRects) {
            minX = Math.min(minX, r.x);
            maxX = Math.max(maxX, r.x + r.w);
            minY = Math.min(minY, r.y);
            maxY = Math.max(maxY, r.y + r.h);
        }

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        node.cluster.mergeTargetPosition = new THREE.Vector3(cx, cy, 0);
        node.cluster.mergeRegion = {
            x: minX, y: minY,
            w: maxX - minX,
            h: maxY - minY
        };
    }
}
