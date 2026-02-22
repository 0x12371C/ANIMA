declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string | Uint8Array,
      zkeyFileName: string | Uint8Array,
    ): Promise<{
      proof: unknown;
      publicSignals: string[];
    }>;
    verify(
      verificationKey: object,
      publicSignals: readonly string[],
      proof: object,
    ): Promise<boolean>;
  };
}
