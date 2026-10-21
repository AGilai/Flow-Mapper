// The synthetic `infra` service that holds channels and bindings brought from another environment (a Components copy, an import):
// they are declared by other services there, and one owner keeps the copy self-contained.

/** "<source>-infra", numbered (`-2`, `-3`...) when the name is taken. */
export function infraOwnerName(taken: Set<string>, source: string): string {
  let name = `${source}-infra`;
  for (let i = 2; taken.has(name); i++) name = `${source}-infra-${i}`;
  return name;
}

/** Binding ids are per service in the source; under one owner they are prefixed with the declaring service. */
export const infraBindingId = (service: string, id: string) => `${service}.${id}`;
