"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageServiceImpl = void 0;
const contracts_1 = require("../services/contracts");
class StorageServiceImpl extends contracts_1.IStorageService {
    constructor() {
        super(...arguments);
        this._store = new Map();
    }
    get(key, defaultValue) {
        if (!this._store.has(key)) {
            return defaultValue;
        }
        return this._store.get(key);
    }
    set(key, value) {
        this._store.set(key, value);
    }
    remove(key) {
        this._store.delete(key);
    }
    has(key) {
        return this._store.has(key);
    }
    clear() {
        this._store.clear();
    }
}
exports.StorageServiceImpl = StorageServiceImpl;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3RvcmFnZVNlcnZpY2VJbXBsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc291cmNlL2ZyYW1ld29yay9pbXBsL1N0b3JhZ2VTZXJ2aWNlSW1wbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxxREFBd0Q7QUFFeEQsTUFBYSxrQkFBbUIsU0FBUSwyQkFBZTtJQUF2RDs7UUFDcUIsV0FBTSxHQUFHLElBQUksR0FBRyxFQUFtQixDQUFDO0lBeUJ6RCxDQUFDO0lBdkJHLEdBQUcsQ0FBSSxHQUFXLEVBQUUsWUFBZ0I7UUFDaEMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDeEIsT0FBTyxZQUFZLENBQUM7UUFDeEIsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFNLENBQUM7SUFDckMsQ0FBQztJQUVELEdBQUcsQ0FBSSxHQUFXLEVBQUUsS0FBUTtRQUN4QixJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDaEMsQ0FBQztJQUVELE1BQU0sQ0FBQyxHQUFXO1FBQ2QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDNUIsQ0FBQztJQUVELEdBQUcsQ0FBQyxHQUFXO1FBQ1gsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNoQyxDQUFDO0lBRUQsS0FBSztRQUNELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDeEIsQ0FBQztDQUNKO0FBMUJELGdEQTBCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IElTdG9yYWdlU2VydmljZSB9IGZyb20gJy4uL3NlcnZpY2VzL2NvbnRyYWN0cyc7XG5cbmV4cG9ydCBjbGFzcyBTdG9yYWdlU2VydmljZUltcGwgZXh0ZW5kcyBJU3RvcmFnZVNlcnZpY2Uge1xuICAgIHByaXZhdGUgcmVhZG9ubHkgX3N0b3JlID0gbmV3IE1hcDxzdHJpbmcsIHVua25vd24+KCk7XG5cbiAgICBnZXQ8VD4oa2V5OiBzdHJpbmcsIGRlZmF1bHRWYWx1ZT86IFQpOiBUIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgaWYgKCF0aGlzLl9zdG9yZS5oYXMoa2V5KSkge1xuICAgICAgICAgICAgcmV0dXJuIGRlZmF1bHRWYWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLl9zdG9yZS5nZXQoa2V5KSBhcyBUO1xuICAgIH1cblxuICAgIHNldDxUPihrZXk6IHN0cmluZywgdmFsdWU6IFQpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5fc3RvcmUuc2V0KGtleSwgdmFsdWUpO1xuICAgIH1cblxuICAgIHJlbW92ZShrZXk6IHN0cmluZyk6IHZvaWQge1xuICAgICAgICB0aGlzLl9zdG9yZS5kZWxldGUoa2V5KTtcbiAgICB9XG5cbiAgICBoYXMoa2V5OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3N0b3JlLmhhcyhrZXkpO1xuICAgIH1cblxuICAgIGNsZWFyKCk6IHZvaWQge1xuICAgICAgICB0aGlzLl9zdG9yZS5jbGVhcigpO1xuICAgIH1cbn1cbiJdfQ==