/**
 * Fase 6: mensagens que chegam entre o snapshot da entrada (`waitSnapshot`) e o momento em que a
 * partida (`NetworkMatch`) liga os próprios ouvintes. Sem isso, o `update` do START_MATCH (ou da
 * primeira jogada de um bot rápido) podia se perder: o cliente ficava na versão 0 até chegar
 * outra atualização (encontrado nos testes de carga/rede da Fase 6).
 */
import type { Room } from '@colyseus/sdk';
import type { SnapshotMessage, UpdateMessage } from '@bardurinho/protocol';

export type EarlyMessage = { kind: 'snapshot'; msg: SnapshotMessage } | { kind: 'update'; msg: UpdateMessage };

const buffers = new WeakMap<Room, { items: EarlyMessage[]; off: Array<() => void> }>();

/** Começa a guardar `snapshot`/`update` da sala até `takeEarly` ser chamado. */
export function bufferEarly(room: Room): void {
  if (buffers.has(room)) return;
  const items: EarlyMessage[] = [];
  const off = [
    room.onMessage('snapshot', (msg: SnapshotMessage) => items.push({ kind: 'snapshot', msg })),
    room.onMessage('update', (msg: UpdateMessage) => items.push({ kind: 'update', msg })),
  ];
  buffers.set(room, { items, off });
}

/** Para de guardar e devolve o que chegou (na ordem). */
export function takeEarly(room: Room): EarlyMessage[] {
  const b = buffers.get(room);
  if (!b) return [];
  for (const f of b.off) f();
  buffers.delete(room);
  return b.items;
}
