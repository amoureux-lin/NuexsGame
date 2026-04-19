"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onAfterMake = exports.onBeforeMake = exports.onError = exports.unload = exports.onAfterBuild = exports.onAfterCompressSettings = exports.onBeforeCompressSettings = exports.onBeforeBuild = exports.load = exports.throwError = void 0;
const fs_1 = __importDefault(require("fs"));
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
function log(...arg) {
    return console.log(`[${PACKAGE_NAME}] `, ...arg);
}
let allAssets = [];
exports.throwError = true;
const load = function () {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`[${PACKAGE_NAME}] Load cocos plugin example in builder.`);
        allAssets = yield Editor.Message.request('asset-db', 'query-assets');
    });
};
exports.load = load;
const onBeforeBuild = function (options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        // Todo some thing
        log(`${PACKAGE_NAME}.webTestOption`, 'onBeforeBuild');
    });
};
exports.onBeforeBuild = onBeforeBuild;
const onBeforeCompressSettings = function (options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        const pkgOptions = options.packages[PACKAGE_NAME];
        if (pkgOptions.webTestOption) {
            console.debug('webTestOption', true);
        }
        // Todo some thing
        console.debug('get settings test', result.settings);
    });
};
exports.onBeforeCompressSettings = onBeforeCompressSettings;
const onAfterCompressSettings = function (options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        // Todo some thing
        console.log('webTestOption', 'onAfterCompressSettings');
    });
};
exports.onAfterCompressSettings = onAfterCompressSettings;
const onAfterBuild = function (options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(result, 'result onAfterBuild');
        const getFileame = (path) => {
            let nameArr = path.split('/');
            return nameArr[nameArr.length - 1];
        };
        let Config = {
            'application.js': result.paths.applicationJS,
            'system.bundle.js': result.paths.systemJs,
            'polyfills.bundle.js': result.paths.polyfillsJs,
            'style.css': result.paths.styleCSS,
            'import-map.json': result.paths.importMap,
            'settings.json': result.paths.settings,
        };
        //内容审查
        for (const key in result.paths) {
            let path = result.paths[key];
            if (typeof path === 'object') {
                continue;
            }
            if (checkPath(path)) {
                try {
                    const content = fs_1.default.readFileSync(path, 'utf8');
                    let newContent = content;
                    for (const [key, value] of Object.entries(Config)) {
                        const regex = new RegExp(key, 'g');
                        newContent = newContent.replace(regex, getFileame(value));
                    }
                    //返回新内容
                    fs_1.default.writeFileSync(path, newContent);
                }
                catch (error) {
                    console.error(`${path} 写入/读取失败: ${error}`);
                }
            }
            else {
                console.log(`${path} is not a file`);
            }
        }
    });
};
exports.onAfterBuild = onAfterBuild;
const unload = function () {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`[${PACKAGE_NAME}] Unload cocos plugin example in builder.`);
    });
};
exports.unload = unload;
const onError = function (options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        // Todo some thing
        console.warn(`${PACKAGE_NAME} run onError`);
    });
};
exports.onError = onError;
const onBeforeMake = function (root, options) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`onBeforeMake: root: ${root}, options: ${options}`);
    });
};
exports.onBeforeMake = onBeforeMake;
const onAfterMake = function (root, options) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`onAfterMake: root: ${root}, options: ${options}`);
    });
};
exports.onAfterMake = onAfterMake;
