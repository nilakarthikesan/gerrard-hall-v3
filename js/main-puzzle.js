import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DataLoader } from './data-loader.js?v=327';
import { LayoutEngine } from './layout-engine.js?v=305';
import { InteractionEngine } from './interaction-engine.js?v=305';
import { AnimationEngine } from './animation-engine.js?v=305';
import { CameraEngine } from './camera-engine.js?v=305';

class PuzzleApp {
    constructor() {
        this.initThree();
        this.initEngines();
        this.initUI();
    }

    initThree() {
        this.container = document.getElementById('canvas-container');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff); // White background
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 150);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);
        
        // Controls
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.autoRotate = false;
        this.orbitControls.autoRotateSpeed = 0;
        
        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
        dirLight.position.set(10, 10, 10);
        this.scene.add(dirLight);

        // World Group
        this.worldGroup = new THREE.Group();
        // Rotate 180 degrees around X-axis to flip right-side up
        this.worldGroup.rotation.x = Math.PI;
        this.scene.add(this.worldGroup);

        // Handle Resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    initEngines() {
        this.dataLoader = new DataLoader();
    }

    initUI() {
        this.ui = {
            loading: document.getElementById('loading'),
            loadingText: document.querySelector('.loading-text'),
            eventLabel: document.getElementById('event-label'),
            progressBar: document.getElementById('timeline-progress'),
            stats: document.getElementById('stats-display'),
            prevBtn: document.getElementById('btn-prev'),
            nextBtn: document.getElementById('btn-next'),
            playBtn: document.getElementById('btn-play'),
            resetBtn: document.getElementById('btn-reset'),
            track: document.getElementById('timeline-track')
        };

        this.ui.prevBtn.addEventListener('click', () => this.step(-1));
        this.ui.nextBtn.addEventListener('click', () => this.step(1));
        this.ui.resetBtn.addEventListener('click', () => this.reset());
        this.ui.playBtn.addEventListener('click', () => this.togglePlay());
        
        this.ui.track.addEventListener('click', (e) => {
            if (!this.animationEngine) return;
            const rect = this.ui.track.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const index = Math.floor(pct * this.animationEngine.mergeEvents.length);
            this.jumpTo(index);
        });
    }

    async start() {
        try {
            this.dataLoader.onProgress = (loaded, total) => {
                this.ui.loadingText.textContent = `Loading Clusters... ${loaded}/${total}`;
            };

            const clusters = await this.dataLoader.load();
            
            if (clusters.size === 0) {
                throw new Error("No clusters loaded. Check console/network.");
            }
        
            // Add all cluster groups to world
            for (const cluster of clusters.values()) {
                this.worldGroup.add(cluster.group);
            }

            // 1. Layout Engine - computes exploded/assembled positions
            this.layoutEngine = new LayoutEngine(clusters);
            this.layoutEngine.computeLayout();

            // 2. Fit camera - START zoomed in on the assembled building
            this.fitCameraToBuilding();

            // 3. Animation Timeline
            this.animationEngine = new AnimationEngine(clusters, this.layoutEngine);
            this.events = this.animationEngine.initTimeline();
            this.currentEventIndex = 0;

            // 4. Interaction
            this.interactionEngine = new InteractionEngine(
                this.camera, 
                this.renderer.domElement, 
                clusters, 
                this.orbitControls
            );

            // 5. Camera Engine
            this.cameraEngine = new CameraEngine(this.camera, this.orbitControls);

            // Initial State: Show first event
            if (this.events.length > 0) {
                this.animationEngine.applyEventInstant(0);
            }
            this.updateUI();

            this.ui.loading.style.display = 'none';
            
            // Start render loop
            this.animate();
            
        } catch (err) {
            console.error("App Start Error:", err);
            this.ui.loadingText.innerHTML = `<span style="color: #ff6b6b">Error starting app:<br>${err.message}</span>`;
        }
    }

    fitCameraToBuilding() {
        // For puzzle mode, fit camera to show the final building size
        // ZOOM IN VERY CLOSE for better visibility
        const merged = this.dataLoader.clusters.get('merged');
        if (!merged || !merged.pointCloud) {
            console.warn("No merged cluster for camera fit");
            return;
        }
        
        const geom = merged.pointCloud.geometry;
        geom.computeBoundingBox();
        
        const box = geom.boundingBox;
        const width = box.max.x - box.min.x;
        const height = box.max.y - box.min.y;
        
        const fov = this.camera.fov;
        const aspect = window.innerWidth / window.innerHeight;
        
        // Calculate distance to fill 100% of screen
        const targetFill = 1.0;
        const distForHeight = height / (2 * targetFill * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
        const distForWidth = width / (2 * targetFill * aspect * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
        
        let dist = Math.max(distForHeight, distForWidth);
        
        // Zoom in EXTREMELY close - only 12% of calculated distance
        // This makes the building fill most of the screen like the user's screenshot
        dist *= 0.12;
        
        // Minimum distance to avoid clipping
        dist = Math.max(dist, 10);
        
        console.log(`=== PUZZLE CAMERA FIT ===`);
        console.log(`Building size: ${width.toFixed(1)} x ${height.toFixed(1)}`);
        console.log(`Camera distance: ${dist.toFixed(1)} (EXTREMELY ZOOMED IN)`);
        
        this.camera.position.set(0, 0, dist);
        this.camera.lookAt(0, 0, 0);
        this.orbitControls.target.set(0, 0, 0);
        this.orbitControls.update();
    }

    step(direction) {
        if (direction > 0) {
            if (this.currentEventIndex < this.events.length - 1) {
                this.currentEventIndex++;
                this.animationEngine.playEvent(this.currentEventIndex, 1);
                this.checkEndSequence();
            }
        } else {
            if (this.currentEventIndex > 0) {
                this.animationEngine.playEvent(this.currentEventIndex, -1);
                this.currentEventIndex--;
            }
        }
        this.updateUI();
    }
    
    jumpTo(index) {
        if (index < 0) index = 0;
        if (index >= this.events.length) index = this.events.length - 1;
        this.currentEventIndex = index;
        this.animationEngine.applyEventInstant(index);
        this.updateUI();
        
        if (index === this.events.length - 1) {
            this.checkEndSequence();
        }
    }

    reset() {
        this.isPlaying = false;
        this.ui.playBtn.textContent = 'Play Sequence';
        this.cameraEngine.stopFlythrough();
        this.jumpTo(0);
    }

    togglePlay() {
        this.isPlaying = !this.isPlaying;
        this.ui.playBtn.textContent = this.isPlaying ? 'Pause' : 'Play Sequence';
        
        if (this.isPlaying && this.currentEventIndex >= this.events.length - 1) {
            this.jumpTo(0);
        }
    }

    checkEndSequence() {
        if (this.currentEventIndex === this.events.length - 1) {
            console.log("Reached final merge! Zooming in VERY CLOSE...");
            
            const merged = this.dataLoader.clusters.get('merged');
            if (merged && merged.pointCloud && merged.pointCloud.geometry) {
                const fov = this.camera.fov;
                const geom = merged.pointCloud.geometry;
                geom.computeBoundingBox();
                
                const box = geom.boundingBox;
                const buildingWidth = box.max.x - box.min.x;
                const buildingHeight = box.max.y - box.min.y;
                
                const targetFill = 1.0; // Fill screen completely
                const aspect = window.innerWidth / window.innerHeight;
                
                const distForHeight = buildingHeight / (2 * targetFill * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
                const distForWidth = buildingWidth / (2 * targetFill * aspect * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
                
                let dist = Math.max(distForHeight, distForWidth);
                
                // Zoom in EXTREMELY close - only 12% of calculated distance
                // This makes the final building fill most of the screen like the user's screenshot
                dist *= 0.12;
                
                // Minimum distance
                dist = Math.max(dist, 10);
                
                console.log(`Final zoom: ${buildingWidth.toFixed(1)} x ${buildingHeight.toFixed(1)}, dist=${dist.toFixed(1)}`);
                
                this.animateCameraTo(0, 0, dist);
            }
        }
    }
    
    animateCameraTo(x, y, z) {
        const startPos = this.camera.position.clone();
        const endPos = new THREE.Vector3(x, y, z);
        const duration = 1.5;
        let elapsed = 0;
        
        const animate = (dt) => {
            elapsed += dt;
            const t = Math.min(elapsed / duration, 1);
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            
            this.camera.position.lerpVectors(startPos, endPos, eased);
            this.orbitControls.update();
            
            if (t < 1) {
                requestAnimationFrame(() => animate(1/60));
            }
        };
        
        animate(0);
    }

    updateUI() {
        const count = this.events.length;
        if (count === 0) return;
        
        const progress = (this.currentEventIndex / (count - 1)) * 100;
        this.ui.progressBar.style.width = `${progress}%`;
        
        const event = this.events[this.currentEventIndex];
        const eventType = event.isLeaf ? 'Showing' : 'Merging into';
        this.ui.eventLabel.textContent = `Event ${this.currentEventIndex + 1}/${count}: ${eventType} ${event.path}`;
        
        let visiblePoints = 0;
        let visibleClusters = 0;
        for (const c of this.dataLoader.clusters.values()) {
            if (c.pointCloud && c.pointCloud.visible) {
                visibleClusters++;
                visiblePoints += c.pointsCount;
            }
        }
        this.ui.stats.textContent = `Clusters: ${visibleClusters} | Points: ${visiblePoints.toLocaleString()}`;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        const time = performance.now() / 1000;
        const dt = 0.016;

        if (this.isPlaying) {
            if (!this.lastStepTime) this.lastStepTime = time;
            if (time - this.lastStepTime > 1.5) {
                if (this.currentEventIndex < this.events.length - 1) {
                    this.step(1);
                    this.lastStepTime = time;
                } else {
                    this.togglePlay();
                }
            }
        } else {
            this.lastStepTime = 0;
        }

        if (this.animationEngine) this.animationEngine.update(dt);
        if (this.cameraEngine) this.cameraEngine.update(time);
        
        this.orbitControls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Start App
const app = new PuzzleApp();
window.app = app;
app.start();

