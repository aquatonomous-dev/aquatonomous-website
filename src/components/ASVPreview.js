import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export default class ASVPreview {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.modelCenter = new THREE.Vector3();

    this.setupCamera();
    this.setupRenderer();
    this.setupLights();

    this.loadBoatModel();
    this.setupControls();
    this.setupResizeHandler();
    this.animate();
  }

  setupCamera() {
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.container.clientWidth / this.container.clientHeight,
      0.01,
      1000
    );
    // Set initial camera position to the opposite side
    this.camera.position.set(-2, 1.5, -2);
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.setClearColor(0x000000, 0);
    this.container.appendChild(this.renderer.domElement);
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);
  }

  createWater() {
    const boundingBox = new THREE.Box3().setFromObject(object);
    const size = boundingBox.getSize(new THREE.Vector3());
    const center = boundingBox.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const aspect = this.container.clientWidth / this.container.clientHeight;
    
    // Calculate the distance required to fit the object in view
    const fov = this.camera.fov * (Math.PI / 180); // Convert FOV to radians
    let cameraDistance = maxDim / (2 * Math.tan(fov / 2));

    // Adjust distance based on aspect ratio
    if (aspect < 1) {
      cameraDistance = cameraDistance / aspect;
    }

    // Set the camera position for an isometric view
    const angle = Math.PI / 2; // 45 degrees
    const heightMultiplier = 1.5; // Adjust to make the camera slightly above
    this.camera.position.set(
      center.x + cameraDistance * Math.sin(angle),
      center.y + cameraDistance * heightMultiplier,
      center.z + cameraDistance * Math.cos(angle)
    );

    // Update the OrbitControls target
    if (this.controls) {
      this.controls.target.copy(center);
      this.controls.update();
    }

    // Ensure the camera looks at the center of the object
    this.camera.lookAt(center);
  }
  

  loadBoatModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    dracoLoader.preload();

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    const modelPath = "/models/ship.glb";

    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;
        
        const boundingBox = new THREE.Box3().setFromObject(model);
        const center = boundingBox.getCenter(new THREE.Vector3());
        const size = boundingBox.getSize(new THREE.Vector3());

        this.modelCenter.copy(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2 / maxDim;
        model.scale.setScalar(scale);

        model.position.x = -1.5;
        model.position.y = -1.75;
        model.position.z = -3.25;

        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        
            // Modify the material to make it transparent
            if (child.material) {
              child.material.transparent = true; // Enable transparency
              child.material.opacity = 0.8; // Set opacity level (0.0 is fully transparent, 1.0 is fully opaque)
            }
        
            // Optional: Add a wireframe for better visualization
            const edgesGeometry = new THREE.EdgesGeometry(child.geometry);
            const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
            const wireframe = new THREE.LineSegments(edgesGeometry, edgesMaterial);
        
            child.add(wireframe);
          }
        });
        

        this.scene.add(model);

        this.zoomToFitObject(model);
      },
      undefined,
      (error) => {
        console.error('An error occurred loading the GLTF model:', error);
      }
    );
  }

  setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 20;
    this.controls.enableZoom = true;
    this.controls.zoomSpeed = 1.0;
    this.controls.maxPolarAngle = Math.PI / 1.5;
    this.controls.minPolarAngle = 0;
    
    this.controls.target.set(0, 0, 0);
  }

  setupResizeHandler() {
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  handleResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize.bind(this));
    this.scene.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}