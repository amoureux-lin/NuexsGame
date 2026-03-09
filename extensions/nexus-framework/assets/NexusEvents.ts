export const NexusEvents = {
    APP_READY:        'APP_READY',
    APP_HIDE:         'APP_HIDE',
    APP_SHOW:         'APP_SHOW',
    BUNDLE_ENTER:     'BUNDLE_ENTER',
    BUNDLE_EXIT:      'BUNDLE_EXIT',
    NET_CONNECTED:    'NET_CONNECTED',
    NET_DISCONNECTED: 'NET_DISCONNECTED',
    LANGUAGE_CHANGED: 'LANGUAGE_CHANGED',
    LOGIN_SUCCESS:    'LOGIN_SUCCESS',
    LOGOUT:           'LOGOUT',
} as const;

export type NexusEventKey = typeof NexusEvents[keyof typeof NexusEvents];
