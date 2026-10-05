import { useEffect, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from "three";

/**
 * Desktop-only WebGL backdrop for the hero: translucent "paper sheets" orbit slowly
 * with wireframe shapes and a dust field; the camera leans toward the pointer.
 * Lazy-loaded by Hero after idle; pauses off-screen / in hidden tabs; colors follow the theme.
 */
export default function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      return; // No WebGL: the static CSS scene stays.
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    node.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 9);

    const palette = () => {
      const style = getComputedStyle(document.documentElement);
      return {
        primary: new Color(
          style.getPropertyValue("--primary").trim() || "#5ee1ff",
        ),
        accent: new Color(
          style.getPropertyValue("--accent").trim() || "#b39dff",
        ),
        light: document.documentElement.dataset.theme === "light",
      };
    };

    const orbit = new Group();
    scene.add(orbit);
    const sheetGeometry = new PlaneGeometry(1.5, 2.05);
    const sheetEdges = new EdgesGeometry(sheetGeometry);
    const sheets: {
      mesh: Mesh;
      edge: LineSegments;
      speed: number;
      phase: number;
    }[] = [];
    const fills: MeshBasicMaterial[] = [];
    const lines: LineBasicMaterial[] = [];
    for (let i = 0; i < 7; i++) {
      const fill = new MeshBasicMaterial({
        transparent: true,
        opacity: 0.08,
        side: DoubleSide,
        depthWrite: false,
      });
      const line = new LineBasicMaterial({ transparent: true, opacity: 0.55 });
      fills.push(fill);
      lines.push(line);
      const mesh = new Mesh(sheetGeometry, fill);
      const edge = new LineSegments(sheetEdges, line);
      mesh.add(edge);
      const angle = (i / 7) * Math.PI * 2;
      const radius = 2.6 + (i % 3) * 0.55;
      mesh.position.set(
        Math.cos(angle) * radius,
        (i % 2 ? 0.6 : -0.5) * (1 + (i % 3) * 0.3),
        Math.sin(angle) * radius - 1,
      );
      mesh.rotation.set(0.2 * (i % 3), angle, 0.15 * ((i % 4) - 1.5));
      orbit.add(mesh);
      sheets.push({ mesh, edge, speed: 0.25 + (i % 4) * 0.08, phase: i * 1.3 });
    }

    const shapeMaterials: LineBasicMaterial[] = [];
    const shapes = [
      { size: 0.9, x: -3.4, y: 1.7, z: -2 },
      { size: 0.55, x: 3.6, y: -1.8, z: -1.5 },
    ].map(({ size, x, y, z }) => {
      const material = new LineBasicMaterial({
        transparent: true,
        opacity: 0.45,
      });
      shapeMaterials.push(material);
      const shape = new LineSegments(
        new EdgesGeometry(new IcosahedronGeometry(size, 0)),
        material,
      );
      shape.position.set(x, y, z);
      scene.add(shape);
      return shape;
    });

    const count = 320;
    const dust = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      dust[i * 3] = (Math.random() - 0.5) * 16;
      dust[i * 3 + 1] = (Math.random() - 0.5) * 9;
      dust[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
    }
    const dustGeometry = new BufferGeometry();
    dustGeometry.setAttribute("position", new Float32BufferAttribute(dust, 3));
    const dustMaterial = new PointsMaterial({
      size: 0.035,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const field = new Points(dustGeometry, dustMaterial);
    scene.add(field);

    const recolor = () => {
      const { primary, accent, light } = palette();
      fills.forEach((m, i) => {
        m.color.copy(i % 2 ? accent : primary);
        m.opacity = light ? 0.1 : 0.07;
      });
      lines.forEach((m, i) => {
        m.color.copy(i % 2 ? accent : primary);
        m.opacity = light ? 0.7 : 0.55;
      });
      shapeMaterials.forEach((m, i) => m.color.copy(i ? accent : primary));
      dustMaterial.color.copy(light ? accent : primary);
      dustMaterial.blending = light ? NormalBlending : AdditiveBlending;
      dustMaterial.needsUpdate = true;
    };
    recolor();
    const themeWatch = new MutationObserver(recolor);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const resize = () => {
      const { width, height } = node.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeWatch = new ResizeObserver(resize);
    resizeWatch.observe(node);

    let targetX = 0,
      targetY = 0;
    const pointer = (event: PointerEvent) => {
      targetX = (event.clientX / innerWidth - 0.5) * 2;
      targetY = (event.clientY / innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", pointer, { passive: true });

    let frame = 0,
      visible = true,
      last = performance.now(),
      time = 0;
    const tick = (now: number) => {
      frame = 0;
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += delta;
      orbit.rotation.y += delta * 0.08;
      for (const s of sheets) {
        s.mesh.position.y += Math.sin(time * s.speed + s.phase) * 0.0025;
        s.mesh.rotation.z += delta * 0.04 * (s.speed - 0.35);
      }
      shapes.forEach((shape, i) => {
        shape.rotation.x += delta * (0.15 + i * 0.1);
        shape.rotation.y += delta * 0.2;
      });
      field.rotation.y += delta * 0.01;
      camera.position.x += (targetX * 0.8 - camera.position.x) * 0.04;
      camera.position.y += (-targetY * 0.5 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, -1);
      renderer.render(scene, camera);
      if (visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const resume = () => {
      if (!frame && visible && !document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const viewWatch = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    viewWatch.observe(node);
    document.addEventListener("visibilitychange", resume);
    resume();
    requestAnimationFrame(() => node.classList.add("ready"));

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", pointer);
      document.removeEventListener("visibilitychange", resume);
      viewWatch.disconnect();
      resizeWatch.disconnect();
      themeWatch.disconnect();
      scene.traverse((object) => {
        const item = object as Mesh;
        item.geometry?.dispose();
        const material = item.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return <div className="hero-scene-3d" ref={host} aria-hidden="true" />;
}
