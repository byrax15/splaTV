export const ShaderHeader = /*glsl*/ `
  #version 300 es
  precision highp float;
  precision highp int;

  #define M_PI 3.1415926535897932384626433832795
  // const float INF_F = 1./0.;

  struct Range {
    float min /* = -4.0f*/, 
          max /* = INF_F*/;
  };

  struct AABB {
    vec3 min, max;
  };

  uniform int displayMode;

  vec3 rescale(vec3 v){
    float minV = min(min(v.x, v.y), v.z);
    float maxV = max(max(v.x, v.y), v.z);
    return (v-minV)/(maxV-minV);
  }

  
  struct ColorMap {
    vec4 close, far, saturate;
  };
  
  const ColorMap colorMap = ColorMap(vec4(1,0,0,1), vec4(0,0,1,1), vec4(1));

  #line 1
`.trim();
