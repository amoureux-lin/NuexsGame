"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetHandlers = exports.configs = exports.unload = exports.load = void 0;
const fs_1 = __importDefault(require("fs"));
const load = function () {
    console.debug(`${PACKAGE_NAME} load`);
};
exports.load = load;
const unload = function () {
    console.debug(`${PACKAGE_NAME} unload`);
};
exports.unload = unload;
function checkPath(path) {
    try {
        const stats = fs_1.default.statSync(path);
        if (stats.isDirectory()) {
            return false;
        }
        else if (stats.isFile()) {
            return true;
        }
        else {
            console.log(`${path} 既不是文件也不是文件夹`);
            return false;
        }
    }
    catch (err) {
        return false;
        console.error(`无法读取路径 ${path}: ${err}`);
    }
}
const PACKAGE_NAME = 'cocos_build_replace_md5';
const complexTestItems = {
    number: {
        label: `i18n:${PACKAGE_NAME}.options.complexTestNumber`,
        description: `i18n:${PACKAGE_NAME}.options.complexTestNumber`,
        default: 80,
        render: {
            ui: 'ui-num-input',
            attributes: {
                step: 1,
                min: 0,
            },
        },
    },
    string: {
        label: `i18n:${PACKAGE_NAME}.options.complexTestString`,
        description: `i18n:${PACKAGE_NAME}.options.complexTestString`,
        default: 'cocos',
        render: {
            ui: 'ui-input',
            attributes: {
                placeholder: `i18n:${PACKAGE_NAME}.options.enterCocos`,
            },
        },
        verifyRules: ['ruleTest'],
    },
    boolean: {
        label: `i18n:${PACKAGE_NAME}.options.complexTestBoolean`,
        description: `i18n:${PACKAGE_NAME}.options.complexTestBoolean`,
        default: true,
        render: {
            ui: 'ui-checkbox',
        },
    },
};
exports.configs = {
    'web-mobile': {
        hooks: './hooks',
        doc: 'editor/publish/custom-build-plugin.html',
        options: {
            remoteAddress: {
                label: `i18n:${PACKAGE_NAME}.options.remoteAddress`,
                default: 'https://www.cocos.com/',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: 'Enter remote address...',
                    },
                },
                verifyRules: ['required'],
            },
            enterCocos: {
                label: `i18n:${PACKAGE_NAME}.options.enterCocos`,
                description: `i18n:${PACKAGE_NAME}.options.enterCocos`,
                default: '',
                render: {
                    /**
                     * @en Please refer to Developer -> UI Component for a list of all supported UI components
                     * @zh 请参考 开发者 -> UI 组件 查看所有支持的 UI 组件列表
                     */
                    ui: 'ui-input',
                    attributes: {
                        placeholder: `i18n:${PACKAGE_NAME}.options.enterCocos`,
                    },
                },
                verifyRules: ['ruleTest'],
                verifyLevel: 'warn',
            },
            selectTest: {
                label: `i18n:${PACKAGE_NAME}.options.selectTest`,
                description: `i18n:${PACKAGE_NAME}.options.selectTest`,
                default: 'option2',
                render: {
                    ui: 'ui-select',
                    items: [
                        {
                            label: `i18n:${PACKAGE_NAME}.options.selectTestOption1`,
                            value: 'option1',
                        },
                        {
                            label: `i18n:${PACKAGE_NAME}.options.selectTestOption2`,
                            value: 'option2',
                        },
                    ],
                },
            },
            objectTest: {
                label: `i18n:${PACKAGE_NAME}.options.objectTest`,
                description: `i18n:${PACKAGE_NAME}.options.objectTest`,
                type: 'object',
                default: {
                    number: complexTestItems.number.default,
                    string: complexTestItems.string.default,
                    boolean: complexTestItems.boolean.default,
                },
                itemConfigs: complexTestItems,
            },
            arrayTest: {
                label: `i18n:${PACKAGE_NAME}.options.arrayTest`,
                description: `i18n:${PACKAGE_NAME}.options.arrayTest`,
                type: 'array',
                default: [complexTestItems.number.default, complexTestItems.string.default, complexTestItems.boolean.default],
                itemConfigs: JSON.parse(JSON.stringify(Object.values(complexTestItems))),
            },
        },
        verifyRuleMap: {
            ruleTest: {
                message: `i18n:${PACKAGE_NAME}.options.ruleTest_msg`,
                func(val, buildOptions) {
                    if (val === 'cocos') {
                        return true;
                    }
                    return false;
                },
            },
        },
    },
};
exports.assetHandlers = './asset-handlers';
