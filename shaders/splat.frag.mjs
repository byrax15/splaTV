import { ShaderHeader } from './splat.glsl.mjs'
import { DisplayMode } from '../display-mode.mjs'

export const fragShaderSource = /* glsl */`
  ${ShaderHeader}
  #line 7

  uniform Range radiusCull;

  in vec4 vColor;
  in vec2 vPosition;
  flat in vec2 vCenter;
  in float vCamDist;
  
  out vec4 fragColor;

  void main () {
      float A = -dot(vPosition, vPosition);
      if (A < -radiusCull.max || A > -radiusCull.min) {
        discard;
      } 

      float B = exp(A) * vColor.a;

      switch (displayMode){
      case ${DisplayMode.Depth}:
        vec4 mapped = mix(colorMap.far, colorMap.close, vCamDist);
        fragColor = vec4(vec3(B * vCamDist), B) * mapped;
        break;
      case ${DisplayMode.Opaque}:
        B = exp(A) * 1.;
        fragColor = vec4(B * vColor.rgb, B);
        break;
      default:
        fragColor = vec4(B * vColor.rgb, B);
        break;
      }
  }
  `.trim()