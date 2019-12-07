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
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const isRelative = require("is-relative");
function convertPathForServer(projectPath, port, target) {
    if (target.match(/^(?:https?:)?\/\//)) {
        return target;
    }
    if (isRelative(target)) {
        target = path.join(projectPath, target);
    }
    let relativePath = path.relative(projectPath, target);
    if (path.sep === '\\') {
        relativePath = relativePath.replace(/\\/g, '/');
    }
    return `http://localhost:${port}/link/${relativePath}`;
}
exports.convertPathForServer = convertPathForServer;
function saveAllTextEditor() {
    return __awaiter(this, void 0, void 0, function* () {
        const array = atom.workspace
            .getTextEditors()
            .filter(item => item.isModified())
            .map(item => item.save());
        return Promise.all(array);
    });
}
exports.saveAllTextEditor = saveAllTextEditor;
//# sourceMappingURL=utils.js.map