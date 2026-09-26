export class ShaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShaderError';
  }
}

function annotateSource(source: string, log: string): string {
  const lines = source.split('\n');
  const referenced = new Set<number>();
  for (const m of log.matchAll(/ERROR:\s*\d+:(\d+)/g)) referenced.add(Number(m[1]));
  const excerpt = [...referenced]
    .map((n) => `${n}: ${lines[n - 1] ?? ''}`)
    .join('\n');
  return excerpt ? `${log}\n--- source ---\n${excerpt}` : log;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string, name: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new ShaderError(`Could not create shader for ${name}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new ShaderError(`Failed to compile ${kind} shader "${name}":\n${annotateSource(source, log)}`);
  }
  return shader;
}

export type UniformValue = number | readonly number[] | Float32Array | Int32Array;

/** Linked GLSL program with cached uniform locations. */
export class Program {
  readonly program: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    readonly name: string,
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, name);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, name);
    const program = gl.createProgram();
    if (!program) throw new ShaderError(`Could not create program ${name}`);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_unit');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown error';
      gl.deleteProgram(program);
      throw new ShaderError(`Failed to link program "${name}": ${log}`);
    }
    this.program = program;
  }

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  location(name: string): WebGLUniformLocation | null {
    let loc = this.locations.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.program, name);
      this.locations.set(name, loc);
    }
    return loc;
  }

  int(name: string, value: number): this {
    this.gl.uniform1i(this.location(name), value);
    return this;
  }

  float(name: string, value: number): this {
    this.gl.uniform1f(this.location(name), value);
    return this;
  }

  vec2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.location(name), x, y);
    return this;
  }

  vec3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.location(name), x, y, z);
    return this;
  }

  vec4(name: string, x: number, y: number, z: number, w: number): this {
    this.gl.uniform4f(this.location(name), x, y, z, w);
    return this;
  }

  ivec2(name: string, x: number, y: number): this {
    this.gl.uniform2i(this.location(name), x, y);
    return this;
  }

  ivec4(name: string, x: number, y: number, z: number, w: number): this {
    this.gl.uniform4i(this.location(name), x, y, z, w);
    return this;
  }

  floats(name: string, values: Float32Array | readonly number[]): this {
    this.gl.uniform1fv(this.location(name), values instanceof Float32Array ? values : new Float32Array(values));
    return this;
  }

  /** Column-major 3×3 matrix. */
  mat3(name: string, values: Float32Array): this {
    this.gl.uniformMatrix3fv(this.location(name), false, values);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

/** Compiles programs once and caches them by key. */
export class ProgramCache {
  private readonly programs = new Map<string, Program>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get(key: string, build: () => { vertex: string; fragment: string }): Program {
    let program = this.programs.get(key);
    if (!program) {
      const { vertex, fragment } = build();
      program = new Program(this.gl, vertex, fragment, key);
      this.programs.set(key, program);
    }
    return program;
  }

  dispose(): void {
    for (const p of this.programs.values()) p.dispose();
    this.programs.clear();
  }
}
