import * as density from "./density.mjs";
import { DisplayMode } from "./display-mode.mjs";

let cameras = [
  {
    id: 0,
    img_name: "00001",
    width: 1959,
    height: 1090,
    position: [-3.0089893469241797, -0.11086489695181866, -3.7527640949141428],
    rotation: [
      [0.876134201218856, 0.06925962026449776, 0.47706599800804744],
      [-0.04747421839895102, 0.9972110940209488, -0.057586739349882114],
      [-0.4797239414934443, 0.027805376500959853, 0.8769787916452908],
    ],
    fy: 1164.6601287484507,
    fx: 1159.5880733038064,
  },
];

let camera = cameras[0];
let hashgrid = new density.HashGrid(new density.Space([0, 0, 0], [0, 0, 0]));

const vertexShaderSource = (async () => {
  const mod = await import('./shaders/splat.vert.mjs')
  return mod.vertexShaderSource
})();


const fragmentShaderSource = (async () => {
  const mod = await import('./shaders/splat.frag.mjs')
  return mod.fragShaderSource
})();

let defaultViewMatrix = [0.99, 0.01, -0.14, 0, 0.02, 0.99, 0.12, 0, 0.14, -0.12, 0.98, 0, -0.09, -0.26, 0.2, 1];

let viewMatrix = defaultViewMatrix;
async function main() {
  let carousel = false;
  const params = new URLSearchParams(location.search);
  try {
    viewMatrix = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    carousel = false;
  } catch (err) { }

  const rowLength = 3 * 4 + 3 * 4 + 4 + 4;
  let splatData = new Uint8Array([]);
  const downsample = splatData.length / rowLength > 500000 ? 1 : 1 / devicePixelRatio;
  console.log(splatData.length / rowLength, downsample);

  const worker = new Worker(
    "worker.mjs",
    { type: "module" }
  );

  const canvas = document.getElementById("canvas");
  const fps = document.getElementById("fps");
  //   const camid = document.getElementById("camid");

  let projectionMatrix;

  /** @type {WebGL2RenderingContext} */
  const gl = canvas.getContext("webgl2", {
    antialias: false,
  });

  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertexShader, await vertexShaderSource);
  gl.compileShader(vertexShader);
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
    console.error(gl.getShaderInfoLog(vertexShader));

  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragmentShader, await fragmentShaderSource);
  gl.compileShader(fragmentShader);
  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS))
    console.error(gl.getShaderInfoLog(fragmentShader));

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.useProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    console.error(gl.getProgramInfoLog(program));

  gl.disable(gl.DEPTH_TEST); // Disable depth testing

  // Enable blending
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
  gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);

  const u_projection = gl.getUniformLocation(program, "projection");
  const u_viewport = gl.getUniformLocation(program, "viewport");
  const u_focal = gl.getUniformLocation(program, "focal");
  const u_view = gl.getUniformLocation(program, "view");
  const u_time = gl.getUniformLocation(program, "time");
  const u_camDistCull = {
    min: gl.getUniformLocation(program, "camDistCull.min"),
    max: gl.getUniformLocation(program, "camDistCull.max"),
  };
  const u_displayMode = gl.getUniformLocation(program, "displayMode")
  const u_radiusCull = {
    min: gl.getUniformLocation(program, "radiusCull.min"),
    max: gl.getUniformLocation(program, "radiusCull.max"),
  };
  const u_opacityCull = {
    min: gl.getUniformLocation(program, "opacityCull.min"),
    max: gl.getUniformLocation(program, "opacityCull.max"),
  };
  const u_aabbCull = {
    min: gl.getUniformLocation(program, "aabbCull.min"),
    max: gl.getUniformLocation(program, "aabbCull.max"),
  };
  const u_voxel = {
    number: gl.getUniformLocation(program, "voxelNumber"),
    space: {
      min: gl.getUniformLocation(program, "voxelSpace.min"),
      max: gl.getUniformLocation(program, "voxelSpace.max"),
    },
  };

  // positions
  const triangleVertices = new Float32Array([-2, -2, 2, -2, 2, 2, -2, 2]);
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, triangleVertices, gl.STATIC_DRAW);
  const a_position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(a_position);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);

  var texture = gl.createTexture();
  var u_textureLocation = gl.getUniformLocation(program, "u_texture");
  gl.uniform1i(u_textureLocation, 0);

  const texDensity = gl.createTexture();
  const u_voxelColors = gl.getUniformLocation(program, "voxelColors");
  gl.uniform1i(u_voxelColors, 1);

  const indexBuffer = gl.createBuffer();
  const a_index = gl.getAttribLocation(program, "index");
  gl.enableVertexAttribArray(a_index);
  gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
  gl.vertexAttribIPointer(a_index, 1, gl.INT, false, 0, 0);
  gl.vertexAttribDivisor(a_index, 1);

  const resize = () => {
    gl.uniform2fv(u_focal, new Float32Array([camera.fx, camera.fy]));

    projectionMatrix = getProjectionMatrix(camera.fx, camera.fy, innerWidth, innerHeight);

    gl.uniform2fv(u_viewport, new Float32Array([innerWidth, innerHeight]));

    gl.canvas.width = Math.round(innerWidth / downsample);
    gl.canvas.height = Math.round(innerHeight / downsample);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    gl.uniformMatrix4fv(u_projection, false, projectionMatrix);
  };

  window.addEventListener("resize", resize);
  resize();

  worker.onmessage = (e) => {
    if (e.data.texdata) {
      const { texdata, texwidth, texheight } = e.data;

      const json = new TextEncoder().encode(
        JSON.stringify([
          {
            type: "splat",
            size: texdata.byteLength,
            texwidth: texwidth,
            texheight: texheight,
            cameras: cameras,
          },
        ])
      );
      const magic = new Uint32Array(2);
      magic[0] = 0x674b;
      magic[1] = json.length;
      const blob = new Blob([magic.buffer, json.buffer, texdata.buffer], {
        type: "application/octet-stream",
      });

      readChunks(new Response(blob).body.getReader(), [{ size: 8, type: "magic" }], chunkHandler);

      const link = document.createElement("a");
      link.download = "model.splatv";
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
    }
    else if (e.data.depthIndex) {
      const { depthIndex, viewProj } = e.data;
      gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, depthIndex, gl.DYNAMIC_DRAW);
      vertexCount = e.data.vertexCount;
    }
    else if ('density' in e.data) {
      hashgrid = density.HashGrid.from(e.data.density);
      const { space } = hashgrid;
      const { colors } = e.data;

      const maxTexSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
      if (density.HashGrid.numberVoxel.some(d => d > maxTexSize)) {
        return;
      }

      const [x, y, z] = density.HashGrid.numberVoxel;
      const colorsT = new Float32Array(density.HashGrid.voxelVolume * 3);
      for (let i = 0; i < x; i++) {
        for (let j = 0; j < y; j++) {
          for (let k = 0; k < z; k++) {
            const idx = 3 * (i * y * z + j * z + k);
            colorsT.set(colors[k][j][i], idx);
            // colorsT.set([k, j, i].map((d, chan) => (d + 1) / density.HashGrid.numberVoxel[chan]), idx);
          }
        }
      }

      gl.uniform3iv(u_voxel.number, density.HashGrid.numberVoxel);
      gl.uniform3fv(u_voxel.space.min, space.min);
      gl.uniform3fv(u_voxel.space.max, space.max);

      gl.activeTexture(gl.TEXTURE1);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      gl.bindTexture(gl.TEXTURE_3D, texDensity);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F,
        x, y, z, 0,
        gl.RGB, gl.FLOAT, colorsT);
    }
  };

  let activeKeys = [];
  let currentCameraIndex = 0;

  window.addEventListener("keydown", (e) => {
    // if (document.activeElement != document.body) return;`
    carousel = false;
    if (!activeKeys.includes(e.code)) activeKeys.push(e.code);
    if (/\d/.test(e.key)) {
      currentCameraIndex = parseInt(e.key);
      camera = cameras[currentCameraIndex];
      viewMatrix = getViewMatrix(camera);
    }
    if (["-", "_"].includes(e.key)) {
      currentCameraIndex = (currentCameraIndex + cameras.length - 1) % cameras.length;
      viewMatrix = getViewMatrix(cameras[currentCameraIndex]);
    }
    if (["+", "="].includes(e.key)) {
      currentCameraIndex = (currentCameraIndex + 1) % cameras.length;
      viewMatrix = getViewMatrix(cameras[currentCameraIndex]);
    }
    // camid.innerText = "cam  " + currentCameraIndex;
    if (e.code == "KeyV") {
      location.hash = "#" + JSON.stringify(viewMatrix.map((k) => Math.round(k * 100) / 100));
      //   camid.innerText = "";
    } else if (e.code === "KeyP") {
      carousel = true;
      //   camid.innerText = "";
    }
  });
  window.addEventListener("keyup", (e) => {
    activeKeys = activeKeys.filter((k) => k !== e.code);
  });
  window.addEventListener("blur", () => {
    activeKeys = [];
  });

  window.addEventListener(
    "wheel",
    (e) => {
      carousel = false;
      e.preventDefault();
      const lineHeight = 10;
      const scale = e.deltaMode == 1 ? lineHeight : e.deltaMode == 2 ? innerHeight : 1;
      let inv = invert4(viewMatrix);
      if (e.shiftKey) {
        inv = translate4(inv, (e.deltaX * scale) / innerWidth, (e.deltaY * scale) / innerHeight, 0);
      } else if (e.ctrlKey || e.metaKey) {
        // inv = rotate4(inv,  (e.deltaX * scale) / innerWidth,  0, 0, 1);
        // inv = translate4(inv,  0, (e.deltaY * scale) / innerHeight, 0);
        // let preY = inv[13];
        inv = translate4(inv, 0, 0, (-10 * (e.deltaY * scale)) / innerHeight);
        // inv[13] = preY;
      } else {
        let d = 4;
        inv = translate4(inv, 0, 0, d);
        inv = rotate4(inv, -(e.deltaX * scale) / innerWidth, 0, 1, 0);
        inv = rotate4(inv, (e.deltaY * scale) / innerHeight, 1, 0, 0);
        inv = translate4(inv, 0, 0, -d);
      }

      viewMatrix = invert4(inv);
    },
    { passive: false }
  );

  let startX, startY, down;
  canvas.addEventListener("mousedown", (e) => {
    carousel = false;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    down = e.ctrlKey || e.metaKey ? 2 : 1;
  });
  canvas.addEventListener("contextmenu", (e) => {
    // console.log("contextmenu?");
    // carousel = false;
    e.preventDefault();
    // startX = e.clientX;
    // startY = e.clientY;
    // down = 2;
  });

  canvas.addEventListener("mousemove", (e) => {
    e.preventDefault();
    if (down == 1) {
      let inv = invert4(viewMatrix);
      let dx = (5 * (e.clientX - startX)) / innerWidth;
      let dy = (5 * (e.clientY - startY)) / innerHeight;
      let d = 4;

      inv = translate4(inv, 0, 0, d);
      inv = rotate4(inv, dx, 0, 1, 0);
      inv = rotate4(inv, -dy, 1, 0, 0);
      inv = translate4(inv, 0, 0, -d);
      // let postAngle = Math.atan2(inv[0], inv[10])
      // inv = rotate4(inv, postAngle - preAngle, 0, 0, 1)
      // console.log(postAngle)
      viewMatrix = invert4(inv);

      startX = e.clientX;
      startY = e.clientY;
    } else if (down == 2) {
      let inv = invert4(viewMatrix);
      // inv = rotateY(inv, );
      // let preY = inv[13];
      inv = translate4(inv, (-10 * (e.clientX - startX)) / innerWidth, 0, (10 * (e.clientY - startY)) / innerHeight);
      // inv[13] = preY;
      viewMatrix = invert4(inv);

      startX = e.clientX;
      startY = e.clientY;
    }
  });
  canvas.addEventListener("mouseup", (e) => {
    e.preventDefault();
    down = false;
    startX = 0;
    startY = 0;
  });

  let altX = 0,
    altY = 0;
  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        carousel = false;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        down = 1;
      } else if (e.touches.length === 2) {
        // console.log('beep')
        carousel = false;
        startX = e.touches[0].clientX;
        altX = e.touches[1].clientX;
        startY = e.touches[0].clientY;
        altY = e.touches[1].clientY;
        down = 1;
      }
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && down) {
        let inv = invert4(viewMatrix);
        let dx = (4 * (e.touches[0].clientX - startX)) / innerWidth;
        let dy = (4 * (e.touches[0].clientY - startY)) / innerHeight;

        let d = 4;
        inv = translate4(inv, 0, 0, d);
        // inv = translate4(inv,  -x, -y, -z);
        // inv = translate4(inv,  x, y, z);
        inv = rotate4(inv, dx, 0, 1, 0);
        inv = rotate4(inv, -dy, 1, 0, 0);
        inv = translate4(inv, 0, 0, -d);

        viewMatrix = invert4(inv);

        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        // alert('beep')
        const dtheta =
          Math.atan2(startY - altY, startX - altX) -
          Math.atan2(e.touches[0].clientY - e.touches[1].clientY, e.touches[0].clientX - e.touches[1].clientX);
        const dscale =
          Math.hypot(startX - altX, startY - altY) /
          Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const dx = (e.touches[0].clientX + e.touches[1].clientX - (startX + altX)) / 2;
        const dy = (e.touches[0].clientY + e.touches[1].clientY - (startY + altY)) / 2;
        let inv = invert4(viewMatrix);
        // inv = translate4(inv,  0, 0, d);
        inv = rotate4(inv, dtheta, 0, 0, 1);

        inv = translate4(inv, -dx / innerWidth, -dy / innerHeight, 0);

        // let preY = inv[13];
        inv = translate4(inv, 0, 0, 3 * (1 - dscale));
        // inv[13] = preY;

        viewMatrix = invert4(inv);

        startX = e.touches[0].clientX;
        altX = e.touches[1].clientX;
        startY = e.touches[0].clientY;
        altY = e.touches[1].clientY;
      }
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      down = false;
      startX = 0;
      startY = 0;
    },
    { passive: false }
  );

  let jumpDelta = 0;
  let vertexCount = 0;

  let lastFrame = 0;
  let avgFps = 0;
  let start = 0;

  window.addEventListener("gamepadconnected", (e) => {
    const gp = navigator.getGamepads()[e.gamepad.index];
    console.log(`Gamepad connected at index ${gp.index}: ${gp.id}. It has ${gp.buttons.length} buttons and ${gp.axes.length} axes.`);
  });
  window.addEventListener("gamepaddisconnected", (e) => {
    console.log("Gamepad disconnected");
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.activeElement.blur();
    }
  })

  let leftGamepadTrigger, rightGamepadTrigger;

  const minMaxRange = {
    min: document.getElementById("min-range"),
    max: document.getElementById("max-range"),
    uploadUniform() {
      gl.uniform1f(u_camDistCull.min, this.min.value)
      gl.uniform1f(u_camDistCull.max, this.max.value)
    }
  }

  const radiusCullRange = {
    min: document.getElementById("min-radius"),
    max: document.getElementById("max-radius"),
    uploadUniform() {
      gl.uniform1f(u_radiusCull.min, this.min.value)
      gl.uniform1f(u_radiusCull.max, this.max.value)
    }
  }

  const opacityCullRange = {
    min: document.getElementById("min-opacity"),
    max: document.getElementById("max-opacity"),
    uploadUniform() {
      gl.uniform1f(u_opacityCull.min, this.min.value)
      gl.uniform1f(u_opacityCull.max, this.max.value)
    }
  }

  const aabbCull = {
    min: [document.getElementById("aabb-min-x"), document.getElementById("aabb-min-y"), document.getElementById("aabb-min-z")],
    max: [document.getElementById("aabb-max-x"), document.getElementById("aabb-max-y"), document.getElementById("aabb-max-z")],
    uploadUniform() {
      if (!u_aabbCull.min || !u_aabbCull.max) return;
      gl.uniform3fv(u_aabbCull.min, new Float32Array(this.min.map(e => e.value)))
      gl.uniform3fv(u_aabbCull.max, new Float32Array(this.max.map(e => e.value)))
    }
  }

  const voxelNumber = {
    uploadUniform() {
      gl.uniform3iv(u_voxel.number, density.HashGrid.numberVoxel);
    }
  }

  const displayMode = new (class {
    mode = document.querySelector("select#draw-mode");
    /** @type {string} */ last = Object.keys(DisplayMode)[0];
    /** @returns {string} */
    get value() { return this.mode.value; }
    set value(v) { return this.mode.value = v; }

    #densityUi = {
      gradient: document.getElementById("density-gradient"),
      min: document.getElementById("density-color-min"),
      max: document.getElementById("density-color-max"),
    }

    uploadUniform() {
      gl.uniform1i(u_displayMode, DisplayMode[this.value])
    }

    swap() {
      switch (DisplayMode[this.value]) {
        case DisplayMode.Density:
        case DisplayMode.VoxelId:
          if (DisplayMode[this.last] !== DisplayMode[this.value]) {
            worker.postMessage({ density: true });
          }
          break;
      }
      switch (DisplayMode[this.value]) {
        case DisplayMode.Density:
          this.#densityUi.gradient.style.display = "";
          this.#densityUi.gradient.style.setProperty("--gradient-min", `rgb(${density.HashGrid.colorMap.min.map(chan=>chan*255)})`);
          this.#densityUi.gradient.style.setProperty("--gradient-max", `rgb(${density.HashGrid.colorMap.max.map(chan=>chan*255)})`);
          this.#densityUi.min.value = hashgrid.density.min;
          this.#densityUi.max.value = hashgrid.density.max;
          break;
        default:
          this.#densityUi.gradient.style.display = "none";
          break;
      }
      this.last = this.value;
    }
  })();

  const timeline = document.querySelector("#timeline");
  const playpause = document.querySelector("#playpause");
  let time = 0;
  const nextTime = () => {
    switch (playpause.dataset.state) {
      case 'play':
        time = Math.sin(Date.now() / 1000) / 2 + 1 / 2
        break
      case 'pause':
        time = timeline.value
        break
    }
    return time
  }

  const frame = (now) => {
    minMaxRange.uploadUniform();
    radiusCullRange.uploadUniform();
    opacityCullRange.uploadUniform();
    aabbCull.uploadUniform();
    voxelNumber.uploadUniform();

    displayMode.uploadUniform();
    displayMode.swap();

    let inv = invert4(viewMatrix);
    let shiftKey = activeKeys.includes("Shift") || activeKeys.includes("ShiftLeft") || activeKeys.includes("ShiftRight");

    if (activeKeys.includes("ArrowUp")) {
      if (shiftKey) {
        inv = translate4(inv, 0, -0.03, 0);
      } else {
        inv = translate4(inv, 0, 0, 0.1);
      }
    }
    if (activeKeys.includes("ArrowDown")) {
      if (shiftKey) {
        inv = translate4(inv, 0, 0.03, 0);
      } else {
        inv = translate4(inv, 0, 0, -0.1);
      }
    }
    if (activeKeys.includes("ArrowLeft")) inv = translate4(inv, -0.03, 0, 0);
    //
    if (activeKeys.includes("ArrowRight")) inv = translate4(inv, 0.03, 0, 0);
    // inv = rotate4(inv, 0.01, 0, 1, 0);
    if (activeKeys.includes("KeyA")) inv = rotate4(inv, -0.01, 0, 1, 0);
    if (activeKeys.includes("KeyD")) inv = rotate4(inv, 0.01, 0, 1, 0);
    if (activeKeys.includes("KeyQ")) inv = rotate4(inv, 0.01, 0, 0, 1);
    if (activeKeys.includes("KeyE")) inv = rotate4(inv, -0.01, 0, 0, 1);
    if (activeKeys.includes("KeyW")) inv = rotate4(inv, 0.005, 1, 0, 0);
    if (activeKeys.includes("KeyS")) inv = rotate4(inv, -0.005, 1, 0, 0);
    if (activeKeys.includes("BracketLeft")) {
      camera.fx /= 1.01;
      camera.fy /= 1.01;
      inv = translate4(inv, 0, 0, 0.1);
      resize();
    }
    if (activeKeys.includes("BracketRight")) {
      camera.fx *= 1.01;
      camera.fy *= 1.01;
      inv = translate4(inv, 0, 0, -0.1);
      resize();
    }
    // console.log(activeKeys);

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let isJumping = activeKeys.includes("Space");
    for (let gamepad of gamepads) {
      if (!gamepad) continue;

      const axisThreshold = 0.1; // Threshold to detect when the axis is intentionally moved
      const moveSpeed = 0.06;
      const rotateSpeed = 0.02;

      // Assuming the left stick controls translation (axes 0 and 1)
      if (Math.abs(gamepad.axes[0]) > axisThreshold) {
        inv = translate4(inv, moveSpeed * gamepad.axes[0], 0, 0);
        carousel = false;
      }
      if (Math.abs(gamepad.axes[1]) > axisThreshold) {
        inv = translate4(inv, 0, 0, -moveSpeed * gamepad.axes[1]);
        carousel = false;
      }
      if (gamepad.buttons[12].pressed || gamepad.buttons[13].pressed) {
        inv = translate4(inv, 0, -moveSpeed * (gamepad.buttons[12].pressed - gamepad.buttons[13].pressed), 0);
        carousel = false;
      }

      if (gamepad.buttons[14].pressed || gamepad.buttons[15].pressed) {
        inv = translate4(inv, -moveSpeed * (gamepad.buttons[14].pressed - gamepad.buttons[15].pressed), 0, 0);
        carousel = false;
      }

      // Assuming the right stick controls rotation (axes 2 and 3)
      if (Math.abs(gamepad.axes[2]) > axisThreshold) {
        inv = rotate4(inv, rotateSpeed * gamepad.axes[2], 0, 1, 0);
        carousel = false;
      }
      if (Math.abs(gamepad.axes[3]) > axisThreshold) {
        inv = rotate4(inv, -rotateSpeed * gamepad.axes[3], 1, 0, 0);
        carousel = false;
      }

      let tiltAxis = gamepad.buttons[6].value - gamepad.buttons[7].value;
      if (Math.abs(tiltAxis) > axisThreshold) {
        inv = rotate4(inv, rotateSpeed * tiltAxis, 0, 0, 1);
        carousel = false;
      }
      if (gamepad.buttons[4].pressed && !leftGamepadTrigger) {
        camera = cameras[(cameras.indexOf(camera) + 1) % cameras.length];
        inv = invert4(getViewMatrix(camera));
        carousel = false;
      }
      if (gamepad.buttons[5].pressed && !rightGamepadTrigger) {
        camera = cameras[(cameras.indexOf(camera) + cameras.length - 1) % cameras.length];
        inv = invert4(getViewMatrix(camera));
        carousel = false;
      }
      leftGamepadTrigger = gamepad.buttons[4].pressed;
      rightGamepadTrigger = gamepad.buttons[5].pressed;
      if (gamepad.buttons[0].pressed) {
        isJumping = true;
        carousel = false;
      }
      if (gamepad.buttons[3].pressed) {
        carousel = true;
      }
    }

    if (["KeyJ", "KeyK", "KeyL", "KeyI"].some((k) => activeKeys.includes(k))) {
      let d = 4;
      inv = translate4(inv, 0, 0, d);
      inv = rotate4(inv, activeKeys.includes("KeyJ") ? -0.05 : activeKeys.includes("KeyL") ? 0.05 : 0, 0, 1, 0);
      inv = rotate4(inv, activeKeys.includes("KeyI") ? 0.05 : activeKeys.includes("KeyK") ? -0.05 : 0, 1, 0, 0);
      inv = translate4(inv, 0, 0, -d);
    }

    viewMatrix = invert4(inv);

    if (carousel) {
      let inv = invert4(defaultViewMatrix);

      const t = Math.sin((Date.now() - start) / 5000);
      inv = translate4(inv, 2.5 * t, 0, 6 * (1 - Math.cos(t)));
      inv = rotate4(inv, -0.6 * t, 0, 1, 0);

      viewMatrix = invert4(inv);
    }

    if (isJumping) {
      jumpDelta = Math.min(1, jumpDelta + 0.05);
    } else {
      jumpDelta = Math.max(0, jumpDelta - 0.05);
    }

    let inv2 = invert4(viewMatrix);
    inv2 = translate4(inv2, 0, -jumpDelta, 0);
    inv2 = rotate4(inv2, -0.1 * jumpDelta, 1, 0, 0);
    let actualViewMatrix = invert4(inv2);

    const viewProj = multiply4(projectionMatrix, actualViewMatrix);
    worker.postMessage({ view: viewProj });

    const currentFps = 1000 / (now - lastFrame) || 0;
    avgFps = (isFinite(avgFps) && avgFps) * 0.9 + currentFps * 0.1;

    if (vertexCount > 0) {
      document.getElementById("spinner").style.display = "none";
      gl.uniformMatrix4fv(u_view, false, actualViewMatrix);

      const time = nextTime();
      gl.uniform1f(u_time, time);
      timeline.value = time;

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, vertexCount);
    } else {
      gl.clear(gl.COLOR_BUFFER_BIT);
      document.getElementById("spinner").style.display = "";
      start = Date.now() + 2000;
    }

    const progress = (100 * vertexCount) / (splatData.length / rowLength);
    if (progress < 100) {
      document.getElementById("progress").style.width = progress + "%";
    } else {
      document.getElementById("progress").style.display = "none";
    }
    fps.innerText = Math.round(avgFps) + " fps";
    lastFrame = now;

    requestAnimationFrame(frame);
  };

  frame();

  // wait for a first frame to be drawn, as there seems to be a hidden dependency computed by Color pass
  setTimeout(() => {
    const DISPLAY_MODE = params.get('DisplayMode') ?? Object.keys(DisplayMode)[0];
    /** @type {HTMLSelectElement} */
    const drawModeSelect = document.querySelector('select#draw-mode');
    for (const name in DisplayMode) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === DISPLAY_MODE;
      drawModeSelect.appendChild(option);
    }
  }, 500);

  const selectFile = (file) => {
    const fr = new FileReader();
    if (/\.json$/i.test(file.name)) {
      fr.onload = () => {
        cameras = JSON.parse(fr.result);
        viewMatrix = getViewMatrix(cameras[0]);
        projectionMatrix = getProjectionMatrix(camera.fx / downsample, camera.fy / downsample, canvas.width, canvas.height);
        gl.uniformMatrix4fv(u_projection, false, projectionMatrix);

        console.log("Loaded Cameras");
      };
      fr.readAsText(file);
    } else {
      fr.onload = () => {
        splatData = new Uint8Array(fr.result);
        console.log("Loaded", Math.floor(splatData.length / rowLength));

        if (splatData[0] == 112 && splatData[1] == 108 && splatData[2] == 121 && splatData[3] == 10) {
          // ply file magic header means it should be handled differently
          worker.postMessage({ ply: splatData.buffer });
        } else if (splatData[0] == 75 && splatData[1] == 103) {
          // splatv file
          readChunks(new Response(splatData).body.getReader(), [{ size: 8, type: "magic" }], chunkHandler).then(() => {
            currentCameraIndex = 0;
            camera = cameras[currentCameraIndex];
            viewMatrix = getViewMatrix(camera);
          });
        } else {
          alert("Unsupported file format!");
        }
      };
      fr.readAsArrayBuffer(file);
    }
  };

  window.addEventListener("hashchange", (e) => {
    try {
      viewMatrix = JSON.parse(decodeURIComponent(location.hash.slice(1)));
      carousel = false;
    } catch (err) { }
  });

  const preventDefault = (e) => {
    e.preventDefault();
    //e.stopPropagation();
  };
  document.addEventListener("dragenter", preventDefault);
  document.addEventListener("dragover", preventDefault);
  document.addEventListener("dragleave", preventDefault);
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    selectFile(e.dataTransfer.files[0]);
  });
  document.querySelector("#scene-file").addEventListener("change", function (e) {
    e.preventDefault();
    selectFile(e.target.files[0]);
  })

  let lastVertexCount = -1;
  const chunkHandler = (chunk, buffer, remaining, chunks) => {
    if (!remaining && chunk.type === "magic") {
      let intView = new Uint32Array(buffer);
      if (intView[0] !== 0x674b) throw new Error("This does not look like a splatv file");
      chunks.push({ size: intView[1], type: "chunks" });
    } else if (!remaining && chunk.type === "chunks") {
      for (let chunk of JSON.parse(new TextDecoder("utf-8").decode(buffer))) {
        chunks.push(chunk);
        if (chunk.type === "splat") {
          cameras = chunk.cameras;
          camera = chunk.cameras[0];
          resize();
        }
      }
    } else if (chunk.type === "splat") {
      if (vertexCount > lastVertexCount || remaining === 0) {
        lastVertexCount = vertexCount;
        worker.postMessage({ texture: new Float32Array(buffer), remaining: remaining });
        console.log("splat", remaining);

        const texdata = new Uint32Array(buffer);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, chunk.texwidth, chunk.texheight, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, texdata);
      }
    } else if (!remaining) {
      console.log("chunk", chunk, buffer);
    }
  };

  const url = params.get("url") ? new URL(params.get("url"), "https://huggingface.co/cakewalk/splat-data/resolve/main/") : "model.splatv";
  const req = await fetch(url, { mode: "cors", credentials: "omit" });
  if (req.status != 200) throw new Error(req.status + " Unable to load " + req.url);

  await readChunks(req.body.getReader(), [{ size: 8, type: "magic" }], chunkHandler);
}

main().catch((err) => {
  console.log(err);
  document.getElementById("spinner").style.display = "none";
  document.getElementById("message").innerText = err.toString();
});

function attachShaders(gl, vertexShaderSource, fragmentShaderSource) {
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(vertexShader));

  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragmentShader, fragmentShaderSource);
  gl.compileShader(fragmentShader);
  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(fragmentShader));

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.useProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(program));
  return program;
}

async function readChunks(reader, chunks, handleChunk) {
  let chunk = chunks.shift();
  let buffer = new Uint8Array(chunk.size);
  let offset = 0;
  while (chunk) {
    let { done, value } = await reader.read();
    if (done) break;
    while (value.length + offset >= chunk.size) {
      buffer.set(value.subarray(0, chunk.size - offset), offset);
      value = value.subarray(chunk.size - offset);
      handleChunk(chunk, buffer.buffer, 0, chunks);
      chunk = chunks.shift();
      if (!chunk) break;
      buffer = new Uint8Array(chunk.size);
      offset = 0;
    }
    if (!chunk) break;
    buffer.set(value, offset);
    offset += value.length;
    handleChunk(chunk, buffer.buffer, buffer.byteLength - offset, chunks);
  }
  if (chunk) handleChunk(chunk, buffer.buffer, 0, chunks);
}

function getProjectionMatrix(fx, fy, width, height) {
  const znear = 0.2;
  const zfar = 200;
  return [
    [(2 * fx) / width, 0, 0, 0],
    [0, -(2 * fy) / height, 0, 0],
    [0, 0, zfar / (zfar - znear), 1],
    [0, 0, -(zfar * znear) / (zfar - znear), 0],
  ].flat();
}

function getViewMatrix(camera) {
  const R = camera.rotation.flat();
  const t = camera.position;
  const camToWorld = [
    [R[0], R[1], R[2], 0],
    [R[3], R[4], R[5], 0],
    [R[6], R[7], R[8], 0],
    [-t[0] * R[0] - t[1] * R[3] - t[2] * R[6], -t[0] * R[1] - t[1] * R[4] - t[2] * R[7], -t[0] * R[2] - t[1] * R[5] - t[2] * R[8], 1],
  ].flat();
  return camToWorld;
}

function multiply4(a, b) {
  return [
    b[0] * a[0] + b[1] * a[4] + b[2] * a[8] + b[3] * a[12],
    b[0] * a[1] + b[1] * a[5] + b[2] * a[9] + b[3] * a[13],
    b[0] * a[2] + b[1] * a[6] + b[2] * a[10] + b[3] * a[14],
    b[0] * a[3] + b[1] * a[7] + b[2] * a[11] + b[3] * a[15],
    b[4] * a[0] + b[5] * a[4] + b[6] * a[8] + b[7] * a[12],
    b[4] * a[1] + b[5] * a[5] + b[6] * a[9] + b[7] * a[13],
    b[4] * a[2] + b[5] * a[6] + b[6] * a[10] + b[7] * a[14],
    b[4] * a[3] + b[5] * a[7] + b[6] * a[11] + b[7] * a[15],
    b[8] * a[0] + b[9] * a[4] + b[10] * a[8] + b[11] * a[12],
    b[8] * a[1] + b[9] * a[5] + b[10] * a[9] + b[11] * a[13],
    b[8] * a[2] + b[9] * a[6] + b[10] * a[10] + b[11] * a[14],
    b[8] * a[3] + b[9] * a[7] + b[10] * a[11] + b[11] * a[15],
    b[12] * a[0] + b[13] * a[4] + b[14] * a[8] + b[15] * a[12],
    b[12] * a[1] + b[13] * a[5] + b[14] * a[9] + b[15] * a[13],
    b[12] * a[2] + b[13] * a[6] + b[14] * a[10] + b[15] * a[14],
    b[12] * a[3] + b[13] * a[7] + b[14] * a[11] + b[15] * a[15],
  ];
}

function invert4(a) {
  let b00 = a[0] * a[5] - a[1] * a[4];
  let b01 = a[0] * a[6] - a[2] * a[4];
  let b02 = a[0] * a[7] - a[3] * a[4];
  let b03 = a[1] * a[6] - a[2] * a[5];
  let b04 = a[1] * a[7] - a[3] * a[5];
  let b05 = a[2] * a[7] - a[3] * a[6];
  let b06 = a[8] * a[13] - a[9] * a[12];
  let b07 = a[8] * a[14] - a[10] * a[12];
  let b08 = a[8] * a[15] - a[11] * a[12];
  let b09 = a[9] * a[14] - a[10] * a[13];
  let b10 = a[9] * a[15] - a[11] * a[13];
  let b11 = a[10] * a[15] - a[11] * a[14];
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  return [
    (a[5] * b11 - a[6] * b10 + a[7] * b09) / det,
    (a[2] * b10 - a[1] * b11 - a[3] * b09) / det,
    (a[13] * b05 - a[14] * b04 + a[15] * b03) / det,
    (a[10] * b04 - a[9] * b05 - a[11] * b03) / det,
    (a[6] * b08 - a[4] * b11 - a[7] * b07) / det,
    (a[0] * b11 - a[2] * b08 + a[3] * b07) / det,
    (a[14] * b02 - a[12] * b05 - a[15] * b01) / det,
    (a[8] * b05 - a[10] * b02 + a[11] * b01) / det,
    (a[4] * b10 - a[5] * b08 + a[7] * b06) / det,
    (a[1] * b08 - a[0] * b10 - a[3] * b06) / det,
    (a[12] * b04 - a[13] * b02 + a[15] * b00) / det,
    (a[9] * b02 - a[8] * b04 - a[11] * b00) / det,
    (a[5] * b07 - a[4] * b09 - a[6] * b06) / det,
    (a[0] * b09 - a[1] * b07 + a[2] * b06) / det,
    (a[13] * b01 - a[12] * b03 - a[14] * b00) / det,
    (a[8] * b03 - a[9] * b01 + a[10] * b00) / det,
  ];
}

function rotate4(a, rad, x, y, z) {
  let len = Math.hypot(x, y, z);
  x /= len;
  y /= len;
  z /= len;
  let s = Math.sin(rad);
  let c = Math.cos(rad);
  let t = 1 - c;
  let b00 = x * x * t + c;
  let b01 = y * x * t + z * s;
  let b02 = z * x * t - y * s;
  let b10 = x * y * t - z * s;
  let b11 = y * y * t + c;
  let b12 = z * y * t + x * s;
  let b20 = x * z * t + y * s;
  let b21 = y * z * t - x * s;
  let b22 = z * z * t + c;
  return [
    a[0] * b00 + a[4] * b01 + a[8] * b02,
    a[1] * b00 + a[5] * b01 + a[9] * b02,
    a[2] * b00 + a[6] * b01 + a[10] * b02,
    a[3] * b00 + a[7] * b01 + a[11] * b02,
    a[0] * b10 + a[4] * b11 + a[8] * b12,
    a[1] * b10 + a[5] * b11 + a[9] * b12,
    a[2] * b10 + a[6] * b11 + a[10] * b12,
    a[3] * b10 + a[7] * b11 + a[11] * b12,
    a[0] * b20 + a[4] * b21 + a[8] * b22,
    a[1] * b20 + a[5] * b21 + a[9] * b22,
    a[2] * b20 + a[6] * b21 + a[10] * b22,
    a[3] * b20 + a[7] * b21 + a[11] * b22,
    ...a.slice(12, 16),
  ];
}

function translate4(a, x, y, z) {
  return [
    ...a.slice(0, 12),
    a[0] * x + a[4] * y + a[8] * z + a[12],
    a[1] * x + a[5] * y + a[9] * z + a[13],
    a[2] * x + a[6] * y + a[10] * z + a[14],
    a[3] * x + a[7] * y + a[11] * z + a[15],
  ];
}

function unwrap(value, error) {
  if (!value) throw error;
  return value;
}