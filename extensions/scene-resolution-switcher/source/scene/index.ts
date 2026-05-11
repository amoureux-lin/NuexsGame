type DesignResolution = {
    width: number;
    height: number;
};

declare const cce: {
    Startup?: {
        initDesignResolution?: () => Promise<void>;
        changeDesignResolution?: (width: number, height: number) => void;
    };
    Engine?: {
        repaintInEditMode?: () => void;
    };
};

export const methods = {
    async refreshDesignResolution(resolution: DesignResolution): Promise<void> {
        if (!cce.Startup?.changeDesignResolution && !cce.Startup?.initDesignResolution) {
            throw new Error('cce.Startup design resolution methods are unavailable.');
        }

        cce.Startup?.changeDesignResolution?.(resolution.width, resolution.height);
        await cce.Startup?.initDesignResolution?.();
        cce.Engine?.repaintInEditMode?.();
    },
};
