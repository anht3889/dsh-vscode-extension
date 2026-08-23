import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CommandDescriptor } from "@deepseek-ai/dsh-commands";
import {
  isUserInvocable,
  type SkillSummary,
} from "@deepseek-ai/dsh-skill";
import type {
  OutboundMessage,
  SlashMenuItem,
} from "@dsh-vscode/contract";

/** Coordinates cancellable slash-catalog reads for the current session. */
export interface SlashCatalog {
  /** Read commands and skills for one picker open. */
  list(requestId: string): void;
  /** Abort and suppress the active read, if any. */
  dispose(): void;
}

function commandItem(command: CommandDescriptor): SlashMenuItem {
  if (command.input === undefined) {
    return {
      source: "command",
      name: command.name,
      description: command.description,
      behavior: "execute",
    };
  }
  return {
    source: "command",
    name: command.name,
    description: command.description,
    behavior: "command-input",
    hint: command.input.hint,
    acceptsImages: command.input.images ?? false,
  };
}

function skillItem(skill: SkillSummary): SlashMenuItem {
  return {
    source: "skill",
    name: skill.name,
    description: skill.description,
    behavior: "insert",
  };
}

/**
 * Create the bridge's latest-open-wins slash-catalog coordinator.
 *
 * @param ctx - bridge context carrying optional command and skill services.
 * @param currentAgent - resolves the current live agent at request time.
 * @param send - emits protocol messages to the extension.
 * @returns a cancellable slash-catalog coordinator.
 */
export function createSlashCatalog(
  ctx: Context,
  currentAgent: () => Agent,
  send: (message: OutboundMessage) => void,
): SlashCatalog {
  let current: AbortController | undefined;

  const list = (requestId: string): void => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    const agent = currentAgent();
    const items: SlashMenuItem[] = [];

    const commandService = ctx.get("commands");
    let commandReadSucceeded = false;
    if (commandService !== undefined) {
      try {
        items.push(...commandService.list(agent).map(commandItem));
        commandReadSucceeded = true;
      } catch {
        // Optional command discovery failed; skill discovery remains independent.
      }
    }

    const skillService = ctx.get("skills");
    void (async () => {
      let skillReadSucceeded = false;
      if (skillService !== undefined) {
        try {
          const skills = await skillService.list({
            cwd: agent.session.header.cwd ?? process.cwd(),
            scope: agent,
            signal: controller.signal,
          });
          items.push(
            ...skills.filter(isUserInvocable).map(skillItem),
          );
          skillReadSucceeded = true;
        } catch {
          // Optional skill discovery failed; command results remain usable.
        }
      }
      if (
        current !== controller ||
        controller.signal.aborted ||
        currentAgent() !== agent
      ) {
        return;
      }
      send({
        kind: "slashItems",
        requestId,
        items,
        availability: {
          commands:
            commandService !== undefined && commandReadSucceeded,
          skills: skillService !== undefined && skillReadSucceeded,
        },
      });
    })();
  };

  const dispose = (): void => {
    current?.abort();
    current = undefined;
  };

  return { list, dispose };
}
