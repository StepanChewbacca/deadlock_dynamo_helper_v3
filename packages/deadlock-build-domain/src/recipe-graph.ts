import { RecipeDefinition, RecipeGraph } from './types';

export function createRecipeGraph(definitions: readonly RecipeDefinition[]): RecipeGraph {
  const componentsByParent = new Map<number, readonly number[]>();

  for (const definition of definitions) {
    const components = definition.componentItemIds
      .filter((itemId) => Number.isSafeInteger(itemId) && itemId > 0)
      .sort((a, b) => a - b);
    componentsByParent.set(definition.parentItemId, components);
  }

  return {
    getComponentIds(parentItemId: number): readonly number[] {
      return componentsByParent.get(parentItemId) ?? [];
    },
    isDirectComponent(parentItemId: number, componentItemId: number): boolean {
      return componentsByParent.get(parentItemId)?.includes(componentItemId) ?? false;
    },
  };
}
