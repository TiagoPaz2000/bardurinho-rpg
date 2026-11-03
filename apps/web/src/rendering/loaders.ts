/**
 * Carregamento de modelos glTF (.glb).
 *
 * Os modelos otimizados usam EXT_meshopt_compression, EXT_texture_webp e
 * KHR_mesh_quantization. O decodificador meshopt é servido localmente pelo Vite
 * (`/vendor/meshopt_decoder.js`, ver vite.config.ts) em vez do CDN do Babylon.
 */
import { LoadAssetContainerAsync, MeshoptCompression, type AssetContainer, type Scene } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

let configured = false;

export function configureLoaders(): void {
  if (configured) return;
  configured = true;
  MeshoptCompression.Configuration = { decoder: { url: '/vendor/meshopt_decoder.js' } };
}

/** Cache de contêineres por URL: cada modelo é baixado/decodificado uma vez e instanciado N vezes. */
export class ModelLibrary {
  private readonly containers = new Map<string, Promise<AssetContainer>>();

  constructor(private readonly scene: Scene) {
    configureLoaders();
  }

  load(url: string): Promise<AssetContainer> {
    let p = this.containers.get(url);
    if (!p) {
      p = LoadAssetContainerAsync(url, this.scene);
      this.containers.set(url, p);
    }
    return p;
  }
}
