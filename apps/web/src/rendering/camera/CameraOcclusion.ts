/**
 * CameraOcclusion (seção 14.7): transparência de paredes e estruturas entre a câmera e o
 * alvo de foco — apenas no cliente, sem alterar colisão, visão, cobertura ou alcance.
 *
 * TODO(fase 2, etapa de oclusão): a cada quadro, lançar raios da câmera até o foco e os
 * personagens visíveis; reduzir `visibility` das malhas atingidas (paredes, pilares,
 * lajes) e restaurar com transição. Trabalhar só sobre malhas que o cliente já pode
 * renderizar. Por enquanto, o FloorView (andar visualizado) cobre o caso das plataformas.
 */
export class CameraOcclusion {
  update(): void {
    // Ainda não implementado (ver TODO acima).
  }
}
