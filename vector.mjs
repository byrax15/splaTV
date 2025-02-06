//import and reexport all functions from gl-matrix
export * from "./node_modules/gl-matrix/esm/index.js";
import { glMatrix, vec3 } from "./node_modules/gl-matrix/esm/index.js";
glMatrix.setMatrixArrayType(Array);

export function hslToRgb(hsl) {
    let [h, s, l] = hsl;
    // Normalize the hue value to be between 0 and 1
    h /= 360.;

    // Calculate chroma
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h * 6) % 2 - 1));
    const m = l - c / 2;

    let r, g, b;

    if (h < 1 / 6) {
        r = c; g = x; b = 0;
    } else if (h < 1 / 3) {
        r = x; g = c; b = 0;
    } else if (h < 1 / 2) {
        r = 0; g = c; b = x;
    } else if (h < 2 / 3) {
        r = 0; g = x; b = c;
    } else if (h < 5 / 6) {
        r = x; g = 0; b = c;
    } else {
        r = c; g = 0; b = x;
    }

    // Add the lightness adjustment
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return [r, g, b];
}

