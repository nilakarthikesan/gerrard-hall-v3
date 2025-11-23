import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DataLoader } from './data-loader.js';
import { LayoutEngine } from './layout-engine.js';
import { InteractionEngine } from './interaction-engine.js';
import { AnimationEngine } from './animation-engine.js';
import { CameraEngine } from './camera-engine.js';

class App {
    constructor() {
        this.initThree();
        this.initEngines();
        this.initUI();
    }

    initThree() {
        this.container = document.getElementById('canvas-container');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111); // Dark gray/black
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0, 20); // Start back
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);
        
        // Controls
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        
        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 10, 10);
        this.scene.add(dirLight);

        // Global Group to hold all clusters (for global orientation fix)
        this.worldGroup = new THREE.Group();
        this.worldGroup.rotation.z = Math.PI; // Fix upside down
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
        // Other engines initialized after data load
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
        
        // Click on timeline
        this.ui.track.addEventListener('click', (e) => {
            if (!this.animationEngine) return;
            const rect = this.ui.track.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const index = Math.floor(pct * this.animationEngine.mergeEvents.length);
            // Ideally jump to index. For now, let's just log or implement jump later.
            // Implementing Jump is hard with animations. 
            // Let's allow jump by "Instant Apply"
            this.jumpTo(index);
        });
    }

    async start() {
        this.dataLoader.onProgress = (loaded, total) => {
            this.ui.loadingText.textContent = `Loading Clusters... ${loaded}/${total}`;
        };

        const clusters = await this.dataLoader.load();
        
        // Add all cluster groups to world
        for (const cluster of clusters.values()) {
            this.worldGroup.add(cluster.group);
        }

        // 1. Layout
        this.layoutEngine = new LayoutEngine(clusters);
        this.layoutEngine.computeLayout();

        // 2. Animation Timeline
        this.animationEngine = new AnimationEngine(clusters);
        this.events = this.animationEngine.initTimeline();
        this.currentEventIndex = 0;

        // 3. Interaction
        this.interactionEngine = new InteractionEngine(
            this.camera, 
            this.renderer.domElement, 
            clusters, 
            this.orbitControls
        );

        // 4. Camera
        this.cameraEngine = new CameraEngine(this.camera, this.orbitControls);

        // Initial State: All Hidden, apply event 0 (or just start empty?)
        // Let's show the first event
        this.animationEngine.applyEventInstant(0);
        this.updateUI();

        this.ui.loading.style.display = 'none';
        
        // Start Loop
        this.animate();
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
            // Restart if at end
            this.jumpTo(0);
        }
    }

    checkEndSequence() {
        if (this.currentEventIndex === this.events.length - 1) {
            // Reached end -> Trigger Cinematic Flythrough
            const merged = this.dataLoader.clusters.get('merged');
            if (merged) {
                this.cameraEngine.startFlythrough(merged.slabPosition, 10, 20); // radius 10, 20s duration
            }
        }
    }

    updateUI() {
        const count = this.events.length;
        const progress = (this.currentEventIndex / (count - 1)) * 100;
        this.ui.progressBar.style.width = `${progress}%`;
        
        const event = this.events[this.currentEventIndex];
        this.ui.eventLabel.textContent = `Event ${this.currentEventIndex + 1}/${count}: Showing ${event.path}`;
        
        // Stats
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
        requestAnimationFrame((t) => this.animate());
        
        const time = performance.now() / 1000;
        const dt = 0.016; // Approx

        // Auto Play logic
        if (this.isPlaying) {
            // Simple interval check or just check if previous tween finished?
            // For now, let's use a timer or just trigger next if no tweens active?
            // Better: Play one event per X seconds.
            if (!this.lastStepTime) this.lastStepTime = time;
            if (time - this.lastStepTime > 1.5) { // 1.5s per event
                if (this.currentEventIndex < this.events.length - 1) {
                    this.step(1);
                    this.lastStepTime = time;
                } else {
                    this.togglePlay(); // Stop at end
                }
            }
        } else {
            this.lastStepTime = 0;
        }

        if (this.animationEngine) this.animationEngine.update(dt);
        if (this.interactionEngine) this.interactionEngine.update && this.interactionEngine.update(dt); // If needed
        if (this.cameraEngine) this.cameraEngine.update(time);
        
        this.renderer.render(this.scene, this.camera);
    }
}

// Start App
const app = new App();
app.start();
