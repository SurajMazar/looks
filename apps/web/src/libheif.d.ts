declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  /** Emscripten factory with the .wasm inlined. */
  const factory: (options?: object) => unknown;
  export default factory;
}
