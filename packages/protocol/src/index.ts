/**
 * @bardurinho/protocol — envelope de rede das intenções do cliente (seção 11.1).
 * O conteúdo do comando é o mesmo `GameplayCommand` do domínio; o envelope adiciona
 * versão do protocolo e identificador para detectar repetição.
 * A integração com Colyseus entra na Fase 3.
 */
import type { CommandError, GameEvent, GameplayCommand } from '@bardurinho/domain';

export const PROTOCOL_VERSION = 1;

export type ClientCommand = GameplayCommand & {
  protocolVersion: number;
  /** UUID gerado pelo cliente; o servidor rejeita repetições. */
  commandId: string;
};

export type ServerResponse =
  | { kind: 'accepted'; commandId: string; turnId: number; events: GameEvent[] }
  | { kind: 'rejected'; commandId: string; error: CommandError };

/** Validação estrutural mínima (etapa 2 da seção 11.2). */
export function isClientCommand(value: unknown): value is ClientCommand {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === 'string' &&
    !v.type.startsWith('DEBUG_') &&
    v.protocolVersion === PROTOCOL_VERSION &&
    typeof v.commandId === 'string' &&
    v.commandId.length > 0
  );
}
