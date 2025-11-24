import * as THREE from 'three';

export class CameraEngine {
    constructor(camera, controls) {
        this.camera = camera;
        this.controls = controls; // OrbitControls
        
        this.mode = 'OVERVIEW'; // 'OVERVIEW' | 'FLYTHROUGH'
        
        // Flythrough state
        this.flyParams = {
            center: new THREE.Vector3(),
            radius: 10,
            duration: 10,
            startTime: 0,
            active: false
        };
    }

    startFlythrough(center, radius, duration = 15) {
        this.mode = 'FLYTHROUGH';
        
        // Disable user controls
        if (this.controls) {
            this.controls.enabled = false;
            this.controls.autoRotate = false;
        }

        this.flyParams.center.copy(center);
        this.flyParams.radius = radius * 2.0; // slightly wider shot
        this.flyParams.duration = duration;
        this.flyParams.startTime = performance.now() / 1000;
        this.flyParams.active = true;
        
        console.log("Starting cinematic flythrough around", center);
    }

    stopFlythrough() {
        this.mode = 'OVERVIEW';
        this.flyParams.active = false;
        
        // Re-enable user controls
        if (this.controls) {
            this.controls.enabled = true;
            this.controls.autoRotate = true;
        }
    }

    update(time) {
        if (this.mode === 'FLYTHROUGH' && this.flyParams.active) {
            const t = (time - this.flyParams.startTime) / this.flyParams.duration;
            
            if (t >= 1) {
                // Loop or Stop? Let's loop for ambiance, or stop.
                // Frank said "ends in a nice resting shot".
                // Let's just keep orbiting smoothly or switch back to autoRotate?
                // Let's loop the orbit parameter but keep mode FLYTHROUGH until user interrupts?
                // Actually, let's just let it orbit indefinitely using time as angle.
            }

            // Orbit logic
            // Angle based on time
            const theta = (time * 0.2); // Slow rotation
            const phi = Math.PI / 6; // 30 degrees elevation
            
            const r = this.flyParams.radius;
            const c = this.flyParams.center;
            
            const x = c.x + r * Math.cos(theta);
            const z = c.z + r * Math.sin(theta);
            const y = c.y + r * Math.tan(phi);
            
            this.camera.position.set(x, y, z);
            this.camera.lookAt(c);
        } else {
            // OVERVIEW mode
            if (this.controls) {
                // Ensure autoRotate is definitely off unless enabled elsewhere
                if (this.controls.autoRotate) this.controls.autoRotate = false;
                this.controls.update();
            }
        }
    }
}
