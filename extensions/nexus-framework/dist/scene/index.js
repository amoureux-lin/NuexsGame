"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.methods = {
    async refreshDesignResolution(resolution) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (!((_a = cce.Startup) === null || _a === void 0 ? void 0 : _a.changeDesignResolution) && !((_b = cce.Startup) === null || _b === void 0 ? void 0 : _b.initDesignResolution)) {
            throw new Error('cce.Startup design resolution methods are unavailable.');
        }
        (_d = (_c = cce.Startup) === null || _c === void 0 ? void 0 : _c.changeDesignResolution) === null || _d === void 0 ? void 0 : _d.call(_c, resolution.width, resolution.height);
        await ((_f = (_e = cce.Startup) === null || _e === void 0 ? void 0 : _e.initDesignResolution) === null || _f === void 0 ? void 0 : _f.call(_e));
        (_h = (_g = cce.Engine) === null || _g === void 0 ? void 0 : _g.repaintInEditMode) === null || _h === void 0 ? void 0 : _h.call(_g);
    },
    refreshI18nComponents(translations) {
        var _a, _b;
        const cocos = getCocosApi();
        const scene = cocos.director.getScene();
        if (!scene) {
            return;
        }
        refreshNodeI18nComponents(scene, translations, cocos);
        (_b = (_a = cce.Engine) === null || _a === void 0 ? void 0 : _a.repaintInEditMode) === null || _b === void 0 ? void 0 : _b.call(_a);
    },
    refreshI18nLabels(translations) {
        exports.methods.refreshI18nComponents(translations);
    },
};
function getCocosApi() {
    const globalCc = globalThis.cc;
    if (globalCc)
        return globalCc;
    if (typeof require === 'function')
        return require('cc');
    throw new Error('Cocos cc api is unavailable.');
}
function refreshNodeI18nComponents(node, translations, cocos) {
    var _a, _b;
    let count = 0;
    for (const comp of node.getComponents(cocos.Component)) {
        if (isI18nComponent(comp)) {
            (_a = comp.refreshEditorPreview) === null || _a === void 0 ? void 0 : _a.call(comp);
        }
        const key = readI18nKey(comp);
        if (!key)
            continue;
        const label = node.getComponent(cocos.Label);
        if (!label) {
            continue;
        }
        label.string = (_b = translations[key]) !== null && _b !== void 0 ? _b : key;
        count++;
    }
    for (const child of node.children) {
        count += refreshNodeI18nComponents(child, translations, cocos);
    }
    return count;
}
function isI18nComponent(comp) {
    var _a;
    const record = comp;
    const ctorName = (_a = comp.constructor) === null || _a === void 0 ? void 0 : _a.name;
    return ctorName === 'I18nLabel'
        || ctorName === 'I18nSprite'
        || 'refreshEditorPreview' in record
        || '_key' in record
        || '_relativePath' in record;
}
function readI18nKey(comp) {
    var _a;
    const record = comp;
    const ctorName = (_a = comp.constructor) === null || _a === void 0 ? void 0 : _a.name;
    if (ctorName !== 'I18nLabel' && !('_key' in record) && !('key' in record))
        return '';
    const key = typeof record.key === 'string' ? record.key : record._key;
    return typeof key === 'string' ? key : '';
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2Uvc2NlbmUvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBb0NhLFFBQUEsT0FBTyxHQUFHO0lBQ25CLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxVQUE0Qjs7UUFDdEQsSUFBSSxDQUFDLENBQUEsTUFBQSxHQUFHLENBQUMsT0FBTywwQ0FBRSxzQkFBc0IsQ0FBQSxJQUFJLENBQUMsQ0FBQSxNQUFBLEdBQUcsQ0FBQyxPQUFPLDBDQUFFLG9CQUFvQixDQUFBLEVBQUUsQ0FBQztZQUM3RSxNQUFNLElBQUksS0FBSyxDQUFDLHdEQUF3RCxDQUFDLENBQUM7UUFDOUUsQ0FBQztRQUVELE1BQUEsTUFBQSxHQUFHLENBQUMsT0FBTywwQ0FBRSxzQkFBc0IsbURBQUcsVUFBVSxDQUFDLEtBQUssRUFBRSxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDM0UsTUFBTSxDQUFBLE1BQUEsTUFBQSxHQUFHLENBQUMsT0FBTywwQ0FBRSxvQkFBb0Isa0RBQUksQ0FBQSxDQUFDO1FBQzVDLE1BQUEsTUFBQSxHQUFHLENBQUMsTUFBTSwwQ0FBRSxpQkFBaUIsa0RBQUksQ0FBQztJQUN0QyxDQUFDO0lBRUQscUJBQXFCLENBQUMsWUFBb0M7O1FBQ3RELE1BQU0sS0FBSyxHQUFHLFdBQVcsRUFBRSxDQUFDO1FBRTVCLE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDeEMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ1QsT0FBTztRQUNYLENBQUM7UUFFRCx5QkFBeUIsQ0FBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3RELE1BQUEsTUFBQSxHQUFHLENBQUMsTUFBTSwwQ0FBRSxpQkFBaUIsa0RBQUksQ0FBQztJQUN0QyxDQUFDO0lBRUQsaUJBQWlCLENBQUMsWUFBb0M7UUFDbEQsZUFBTyxDQUFDLHFCQUFxQixDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ2hELENBQUM7Q0FDSixDQUFDO0FBRUYsU0FBUyxXQUFXO0lBQ2hCLE1BQU0sUUFBUSxHQUFJLFVBQWdDLENBQUMsRUFBRSxDQUFDO0lBQ3RELElBQUksUUFBUTtRQUFFLE9BQU8sUUFBUSxDQUFDO0lBRTlCLElBQUksT0FBTyxPQUFPLEtBQUssVUFBVTtRQUFFLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRXhELE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLENBQUMsQ0FBQztBQUNwRCxDQUFDO0FBRUQsU0FBUyx5QkFBeUIsQ0FBQyxJQUFlLEVBQUUsWUFBb0MsRUFBRSxLQUFlOztJQUNyRyxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7SUFDZCxLQUFLLE1BQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxhQUFhLENBQWlCLEtBQUssQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3JFLElBQUksZUFBZSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDeEIsTUFBQSxJQUFJLENBQUMsb0JBQW9CLG9EQUFJLENBQUM7UUFDbEMsQ0FBQztRQUVELE1BQU0sR0FBRyxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUM5QixJQUFJLENBQUMsR0FBRztZQUFFLFNBQVM7UUFFbkIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBcUIsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ2pFLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNULFNBQVM7UUFDYixDQUFDO1FBRUQsS0FBSyxDQUFDLE1BQU0sR0FBRyxNQUFBLFlBQVksQ0FBQyxHQUFHLENBQUMsbUNBQUksR0FBRyxDQUFDO1FBQ3hDLEtBQUssRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVELEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ2hDLEtBQUssSUFBSSx5QkFBeUIsQ0FBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ25FLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQztBQUNqQixDQUFDO0FBRUQsU0FBUyxlQUFlLENBQUMsSUFBb0I7O0lBQ3pDLE1BQU0sTUFBTSxHQUFHLElBQTBDLENBQUM7SUFDMUQsTUFBTSxRQUFRLEdBQUcsTUFBQSxJQUFJLENBQUMsV0FBVywwQ0FBRSxJQUFJLENBQUM7SUFDeEMsT0FBTyxRQUFRLEtBQUssV0FBVztXQUN4QixRQUFRLEtBQUssWUFBWTtXQUN6QixzQkFBc0IsSUFBSSxNQUFNO1dBQ2hDLE1BQU0sSUFBSSxNQUFNO1dBQ2hCLGVBQWUsSUFBSSxNQUFNLENBQUM7QUFDckMsQ0FBQztBQUVELFNBQVMsV0FBVyxDQUFDLElBQW9COztJQUNyQyxNQUFNLE1BQU0sR0FBRyxJQUEwQyxDQUFDO0lBQzFELE1BQU0sUUFBUSxHQUFHLE1BQUEsSUFBSSxDQUFDLFdBQVcsMENBQUUsSUFBSSxDQUFDO0lBQ3hDLElBQUksUUFBUSxLQUFLLFdBQVcsSUFBSSxDQUFDLENBQUMsTUFBTSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLElBQUksTUFBTSxDQUFDO1FBQUUsT0FBTyxFQUFFLENBQUM7SUFFckYsTUFBTSxHQUFHLEdBQUcsT0FBTyxNQUFNLENBQUMsR0FBRyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQztJQUN0RSxPQUFPLE9BQU8sR0FBRyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDOUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbInR5cGUgRGVzaWduUmVzb2x1dGlvbiA9IHtcbiAgICB3aWR0aDogbnVtYmVyO1xuICAgIGhlaWdodDogbnVtYmVyO1xufTtcblxudHlwZSBTY2VuZU5vZGUgPSB7XG4gICAgY2hpbGRyZW46IFNjZW5lTm9kZVtdO1xuICAgIGdldENvbXBvbmVudDxUID0gdW5rbm93bj4odHlwZTogdW5rbm93bik6IFQgfCBudWxsO1xuICAgIGdldENvbXBvbmVudHM8VCA9IHVua25vd24+KHR5cGU6IHVua25vd24pOiBUW107XG59O1xuXG50eXBlIFNjZW5lQ29tcG9uZW50ID0ge1xuICAgIGNvbnN0cnVjdG9yPzogeyBuYW1lPzogc3RyaW5nIH07XG4gICAgcmVmcmVzaEVkaXRvclByZXZpZXc/OiAoKSA9PiB2b2lkO1xufTtcblxudHlwZSBDb2Nvc0FwaSA9IHtcbiAgICBDb21wb25lbnQ6IHVua25vd247XG4gICAgTGFiZWw6IHVua25vd247XG4gICAgZGlyZWN0b3I6IHtcbiAgICAgICAgZ2V0U2NlbmUoKTogU2NlbmVOb2RlIHwgbnVsbDtcbiAgICB9O1xufTtcblxuZGVjbGFyZSBjb25zdCBjY2U6IHtcbiAgICBTdGFydHVwPzoge1xuICAgICAgICBpbml0RGVzaWduUmVzb2x1dGlvbj86ICgpID0+IFByb21pc2U8dm9pZD47XG4gICAgICAgIGNoYW5nZURlc2lnblJlc29sdXRpb24/OiAod2lkdGg6IG51bWJlciwgaGVpZ2h0OiBudW1iZXIpID0+IHZvaWQ7XG4gICAgfTtcbiAgICBFbmdpbmU/OiB7XG4gICAgICAgIHJlcGFpbnRJbkVkaXRNb2RlPzogKCkgPT4gdm9pZDtcbiAgICB9O1xufTtcblxuZGVjbGFyZSBjb25zdCByZXF1aXJlOiAoKG5hbWU6IHN0cmluZykgPT4gQ29jb3NBcGkpIHwgdW5kZWZpbmVkO1xuXG5leHBvcnQgY29uc3QgbWV0aG9kcyA9IHtcbiAgICBhc3luYyByZWZyZXNoRGVzaWduUmVzb2x1dGlvbihyZXNvbHV0aW9uOiBEZXNpZ25SZXNvbHV0aW9uKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghY2NlLlN0YXJ0dXA/LmNoYW5nZURlc2lnblJlc29sdXRpb24gJiYgIWNjZS5TdGFydHVwPy5pbml0RGVzaWduUmVzb2x1dGlvbikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdjY2UuU3RhcnR1cCBkZXNpZ24gcmVzb2x1dGlvbiBtZXRob2RzIGFyZSB1bmF2YWlsYWJsZS4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNjZS5TdGFydHVwPy5jaGFuZ2VEZXNpZ25SZXNvbHV0aW9uPy4ocmVzb2x1dGlvbi53aWR0aCwgcmVzb2x1dGlvbi5oZWlnaHQpO1xuICAgICAgICBhd2FpdCBjY2UuU3RhcnR1cD8uaW5pdERlc2lnblJlc29sdXRpb24/LigpO1xuICAgICAgICBjY2UuRW5naW5lPy5yZXBhaW50SW5FZGl0TW9kZT8uKCk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hJMThuQ29tcG9uZW50cyh0cmFuc2xhdGlvbnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiB2b2lkIHtcbiAgICAgICAgY29uc3QgY29jb3MgPSBnZXRDb2Nvc0FwaSgpO1xuXG4gICAgICAgIGNvbnN0IHNjZW5lID0gY29jb3MuZGlyZWN0b3IuZ2V0U2NlbmUoKTtcbiAgICAgICAgaWYgKCFzY2VuZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVmcmVzaE5vZGVJMThuQ29tcG9uZW50cyhzY2VuZSwgdHJhbnNsYXRpb25zLCBjb2Nvcyk7XG4gICAgICAgIGNjZS5FbmdpbmU/LnJlcGFpbnRJbkVkaXRNb2RlPy4oKTtcbiAgICB9LFxuXG4gICAgcmVmcmVzaEkxOG5MYWJlbHModHJhbnNsYXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogdm9pZCB7XG4gICAgICAgIG1ldGhvZHMucmVmcmVzaEkxOG5Db21wb25lbnRzKHRyYW5zbGF0aW9ucyk7XG4gICAgfSxcbn07XG5cbmZ1bmN0aW9uIGdldENvY29zQXBpKCk6IENvY29zQXBpIHtcbiAgICBjb25zdCBnbG9iYWxDYyA9IChnbG9iYWxUaGlzIGFzIHsgY2M/OiBDb2Nvc0FwaSB9KS5jYztcbiAgICBpZiAoZ2xvYmFsQ2MpIHJldHVybiBnbG9iYWxDYztcblxuICAgIGlmICh0eXBlb2YgcmVxdWlyZSA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIHJlcXVpcmUoJ2NjJyk7XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvY29zIGNjIGFwaSBpcyB1bmF2YWlsYWJsZS4nKTtcbn1cblxuZnVuY3Rpb24gcmVmcmVzaE5vZGVJMThuQ29tcG9uZW50cyhub2RlOiBTY2VuZU5vZGUsIHRyYW5zbGF0aW9uczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgY29jb3M6IENvY29zQXBpKTogbnVtYmVyIHtcbiAgICBsZXQgY291bnQgPSAwO1xuICAgIGZvciAoY29uc3QgY29tcCBvZiBub2RlLmdldENvbXBvbmVudHM8U2NlbmVDb21wb25lbnQ+KGNvY29zLkNvbXBvbmVudCkpIHtcbiAgICAgICAgaWYgKGlzSTE4bkNvbXBvbmVudChjb21wKSkge1xuICAgICAgICAgICAgY29tcC5yZWZyZXNoRWRpdG9yUHJldmlldz8uKCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBrZXkgPSByZWFkSTE4bktleShjb21wKTtcbiAgICAgICAgaWYgKCFrZXkpIGNvbnRpbnVlO1xuXG4gICAgICAgIGNvbnN0IGxhYmVsID0gbm9kZS5nZXRDb21wb25lbnQ8eyBzdHJpbmc6IHN0cmluZyB9Pihjb2Nvcy5MYWJlbCk7XG4gICAgICAgIGlmICghbGFiZWwpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgbGFiZWwuc3RyaW5nID0gdHJhbnNsYXRpb25zW2tleV0gPz8ga2V5O1xuICAgICAgICBjb3VudCsrO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5jaGlsZHJlbikge1xuICAgICAgICBjb3VudCArPSByZWZyZXNoTm9kZUkxOG5Db21wb25lbnRzKGNoaWxkLCB0cmFuc2xhdGlvbnMsIGNvY29zKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnQ7XG59XG5cbmZ1bmN0aW9uIGlzSTE4bkNvbXBvbmVudChjb21wOiBTY2VuZUNvbXBvbmVudCk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHJlY29yZCA9IGNvbXAgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBjb25zdCBjdG9yTmFtZSA9IGNvbXAuY29uc3RydWN0b3I/Lm5hbWU7XG4gICAgcmV0dXJuIGN0b3JOYW1lID09PSAnSTE4bkxhYmVsJ1xuICAgICAgICB8fCBjdG9yTmFtZSA9PT0gJ0kxOG5TcHJpdGUnXG4gICAgICAgIHx8ICdyZWZyZXNoRWRpdG9yUHJldmlldycgaW4gcmVjb3JkXG4gICAgICAgIHx8ICdfa2V5JyBpbiByZWNvcmRcbiAgICAgICAgfHwgJ19yZWxhdGl2ZVBhdGgnIGluIHJlY29yZDtcbn1cblxuZnVuY3Rpb24gcmVhZEkxOG5LZXkoY29tcDogU2NlbmVDb21wb25lbnQpOiBzdHJpbmcge1xuICAgIGNvbnN0IHJlY29yZCA9IGNvbXAgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBjb25zdCBjdG9yTmFtZSA9IGNvbXAuY29uc3RydWN0b3I/Lm5hbWU7XG4gICAgaWYgKGN0b3JOYW1lICE9PSAnSTE4bkxhYmVsJyAmJiAhKCdfa2V5JyBpbiByZWNvcmQpICYmICEoJ2tleScgaW4gcmVjb3JkKSkgcmV0dXJuICcnO1xuXG4gICAgY29uc3Qga2V5ID0gdHlwZW9mIHJlY29yZC5rZXkgPT09ICdzdHJpbmcnID8gcmVjb3JkLmtleSA6IHJlY29yZC5fa2V5O1xuICAgIHJldHVybiB0eXBlb2Yga2V5ID09PSAnc3RyaW5nJyA/IGtleSA6ICcnO1xufVxuIl19