import { cleanI18nSpriteSerializedDependencies } from './i18n-sprite-cleaner';

const PACKAGE_NAME = 'nexus-framework';

export const load = function(): void {};

export const unload = function(): void {};

export const onBeforeBuild = async function(): Promise<void> {
    const changedCount = cleanI18nSpriteSerializedDependencies(Editor.Project.path);
    if (changedCount > 0) {
        console.log(`[${PACKAGE_NAME}] Cleaned i18n sprite preview dependencies before build: ${changedCount}`);
    }
};
