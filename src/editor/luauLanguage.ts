import type * as Monaco from 'monaco-editor';

export const LUAU_LANGUAGE_ID = 'luau';

export const luauTokensProvider: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.luau',

  keywords: [
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
    'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then',
    'true', 'until', 'while', 'continue', 'export', 'type', 'typeof',
  ],

  builtinTypes: [
    'string', 'number', 'boolean', 'table', 'function', 'thread', 'userdata',
    'nil', 'any', 'never', 'unknown',
  ],

  robloxTypes: [
    'Instance', 'Player', 'Part', 'Model', 'Humanoid', 'Character', 'Tool',
    'Script', 'LocalScript', 'ModuleScript', 'RemoteEvent', 'RemoteFunction',
    'BindableEvent', 'BindableFunction', 'Vector3', 'Vector2', 'CFrame',
    'Color3', 'BrickColor', 'UDim', 'UDim2', 'Rect', 'Region3', 'Ray',
    'TweenInfo', 'NumberSequence', 'ColorSequence', 'NumberRange',
    'Faces', 'Axes', 'RaycastParams', 'OverlapParams', 'RaycastResult',
    'Enum', 'EnumItem', 'RBXScriptSignal', 'RBXScriptConnection',
  ],

  robloxGlobals: [
    'game', 'workspace', 'script', 'plugin', 'shared', 'Enum',
  ],

  robloxServices: [
    'Players', 'Workspace', 'ReplicatedStorage', 'ReplicatedFirst',
    'ServerStorage', 'ServerScriptService', 'StarterGui', 'StarterPack',
    'StarterPlayer', 'StarterPlayerScripts', 'StarterCharacterScripts',
    'Lighting', 'SoundService', 'TweenService', 'RunService', 'UserInputService',
    'ContextActionService', 'HttpService', 'MarketplaceService', 'DataStoreService',
    'MessagingService', 'TeleportService', 'TextService', 'PathfindingService',
    'PhysicsService', 'CollectionService', 'Debris', 'Chat', 'Teams',
    'BadgeService', 'InsertService', 'GamePassService', 'AssetService',
    'PolicyService', 'LocalizationService', 'MemoryStoreService',
  ],

  builtinFunctions: [
    'assert', 'collectgarbage', 'error', 'getfenv', 'getmetatable', 'ipairs',
    'loadstring', 'newproxy', 'next', 'pairs', 'pcall', 'print', 'rawequal',
    'rawget', 'rawset', 'require', 'select', 'setfenv', 'setmetatable',
    'tonumber', 'tostring', 'type', 'typeof', 'unpack', 'xpcall', 'warn',
  ],

  executorGlobals: [
    'identifyexecutor',
    'Drawing', 'debug', 'cloneref', 'compareinstances',
    'WebSocket', 'Websocket', 'websocket', 'raknet',
  ],

  executorEnvironment: [
    'getgenv', 'getrenv', 'getsenv',
    'getgc', 'filtergc', 'getreg', 'getinstances', 'getnilinstances', 'getscripts', 'getloadedmodules',
    'getrunningscripts', 'getcallingscript', 'getscriptclosure', 'getscripthash',
    'getscriptbytecode', 'getthreadidentity', 'setthreadidentity',
  ],

  executorHooking: [
    'hookfunction', 'hookmetamethod', 'restorefunction',
    'newcclosure', 'iscclosure', 'islclosure', 'isexecutorclosure',
    'checkcaller', 'clonefunction', 'getfunctionhash', 'getrawmetatable', 'setrawmetatable',
    'getnamecallmethod', 'gethiddenproperty',
    'sethiddenproperty', 'setreadonly', 'isreadonly', 'isscriptable', 'setscriptable',
  ],

  executorSecurity: [
    'getconstant', 'setconstant',
    'getconstants', 'getupvalue', 'setupvalue', 'getupvalues', 'getproto',
    'getprotos', 'getstack', 'setstack', 'getconnections',
    'firesignal', 'replicatesignal',
  ],

  executorFilesystem: [
    'readfile', 'writefile', 'appendfile', 'loadfile',
    'isfile', 'isfolder', 'makefolder', 'delfolder', 'delfile', 'listfiles',
    'getcustomasset',
  ],

  executorFiring: [
    'fireclickdetector', 'fireproximityprompt', 'firetouchinterest',
    'getcallbackvalue',
  ],

  executorMisc: [
    'request',
    'gethui', 'identifyexecutor',
    'lz4compress', 'lz4decompress', 'base64encode', 'base64decode',
    'cloneref', 'compareinstances', 'loadstring',
    'cleardrawcache', 'getrenderproperty', 'setrenderproperty', 'isrenderobj',
  ],

  taskFunctions: [
    'spawn', 'defer', 'delay', 'wait', 'cancel', 'synchronize', 'desynchronize',
  ],

  mathFunctions: [
    'abs', 'acos', 'asin', 'atan', 'atan2', 'ceil', 'clamp', 'cos', 'cosh',
    'deg', 'exp', 'floor', 'fmod', 'frexp', 'huge', 'ldexp', 'log', 'log10',
    'max', 'min', 'modf', 'noise', 'pi', 'pow', 'rad', 'random', 'randomseed',
    'round', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh',
  ],

  stringFunctions: [
    'byte', 'char', 'dump', 'find', 'format', 'gmatch', 'gsub', 'len', 'lower',
    'match', 'pack', 'packsize', 'rep', 'reverse', 'split', 'sub', 'unpack', 'upper',
  ],

  tableFunctions: [
    'clear', 'clone', 'concat', 'create', 'find', 'foreach', 'foreachi',
    'freeze', 'getn', 'insert', 'isfrozen', 'maxn', 'move', 'pack', 'remove',
    'sort', 'unpack',
  ],

  operators: [
    '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '~=',
    'and', 'or', 'not', '+', '-', '*', '/', '%', '^', '#', '..',
    '+=', '-=', '*=', '/=', '%=', '^=', '..=',
  ],

  symbols: /[=><!~?:&|+\-*\/\^%#]+/,

  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u\{[0-9A-Fa-f]+\}|[0-9]{1,3})/,

  tokenizer: {
    root: [
      [/--\[(=*)\[/, 'comment', '@comment.$1'],
      [/--.*$/, 'comment'],

      [/\[(=*)\[/, 'string', '@string.$1'],

      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string_double'],
      [/'/, 'string', '@string_single'],

      [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+/, 'number.hex'],
      [/0[bB][01]+/, 'number.binary'],
      [/\d+/, 'number'],

      [/[a-zA-Z_]\w*/, {
        cases: {
          '@keywords': 'keyword',
          '@builtinTypes': 'type',
          '@robloxTypes': 'type.roblox',
          '@robloxGlobals': 'variable.roblox',
          '@robloxServices': 'variable.service',
          '@builtinFunctions': 'support.function',
          '@executorGlobals': 'variable.executor',
          '@executorEnvironment': 'function.executor',
          '@executorHooking': 'function.executor',
          '@executorSecurity': 'function.executor',
          '@executorFilesystem': 'function.executor',
          '@executorFiring': 'function.executor',
          '@executorMisc': 'function.executor',
          'self': 'variable.language',
          '@default': 'identifier',
        },
      }],

      [/[{}()\[\]]/, '@brackets'],
      [/@symbols/, {
        cases: {
          '@operators': 'operator',
          '@default': '',
        },
      }],

      [/[;,.]/, 'delimiter'],
    ],

    comment: [
      [/[^\]]+/, 'comment'],
      [/\](=*)\]/, {
        cases: {
          '$1==$S2': { token: 'comment', next: '@pop' },
          '@default': 'comment',
        },
      }],
      [/./, 'comment'],
    ],

    string: [
      [/[^\]]+/, 'string'],
      [/\](=*)\]/, {
        cases: {
          '$1==$S2': { token: 'string', next: '@pop' },
          '@default': 'string',
        },
      }],
      [/./, 'string'],
    ],

    string_double: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],

    string_single: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop'],
    ],
  },
};

export const luauTheme: Monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C586C0' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'string.escape', foreground: 'D7BA7D' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'number.float', foreground: 'B5CEA8' },
    { token: 'number.hex', foreground: 'B5CEA8' },
    { token: 'operator', foreground: 'D4D4D4' },
    { token: 'delimiter', foreground: 'D4D4D4' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'type.roblox', foreground: '4FC1FF' },
    { token: 'variable.roblox', foreground: '9CDCFE' },
    { token: 'variable.service', foreground: '4EC9B0' },
    { token: 'variable.language', foreground: '569CD6' },
    { token: 'variable.executor', foreground: 'FFFFFF' },
    { token: 'function.executor', foreground: 'FF6B6B' },
    { token: 'support.function', foreground: 'DCDCAA' },
    { token: 'identifier', foreground: '9CDCFE' },
  ],
  colors: {
    'editor.background': '#0B0B0F',
    'editor.foreground': '#D4D4D4',
    'editor.lineHighlightBackground': '#18181d',
    'editor.selectionBackground': '#264F78',
    'editor.inactiveSelectionBackground': '#3A3D41',
    'editorIndentGuide.background': '#2A2A35',
    'editorIndentGuide.activeBackground': '#3A3D41',
    'editorCursor.foreground': '#FFFFFF',
    'editor.selectionHighlightBackground': '#ADD6FF26',
    'editorLineNumber.foreground': '#5A5A5F',
    'editorLineNumber.activeForeground': '#C6C6C6',
    'editorGutter.background': '#0B0B0F',
    'editorWidget.background': '#0d0d11',
    'editorWidget.border': '#1a1a1f',
    'editorSuggestWidget.background': '#0d0d11',
    'editorSuggestWidget.border': '#1a1a1f',
    'editorSuggestWidget.foreground': '#D4D4D4',
    'editorSuggestWidget.selectedBackground': '#18181d',
    'editorSuggestWidget.highlightForeground': '#FFFFFF',
    'editorHoverWidget.background': '#0d0d11',
    'editorHoverWidget.border': '#1a1a1f',
    'list.hoverBackground': '#18181d',
    'list.activeSelectionBackground': '#18181d',
    'list.focusBackground': '#18181d',
    'scrollbar.shadow': '#00000033',
    'scrollbarSlider.background': '#2a2a3580',
    'scrollbarSlider.hoverBackground': '#3a3a4580',
    'scrollbarSlider.activeBackground': '#4a4a5580',
  },
};

export function registerLuauLanguage(monaco: typeof Monaco): void {
  monaco.languages.register({ id: LUAU_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(LUAU_LANGUAGE_ID, luauTokensProvider);

  monaco.languages.setLanguageConfiguration(LUAU_LANGUAGE_ID, {
    comments: {
      lineComment: '--',
      blockComment: ['--[[', ']]'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string'] },
      { open: '[[', close: ']]' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    folding: {
      markers: {
        start: /^\s*--\s*#?region\b/,
        end: /^\s*--\s*#?endregion\b/,
      },
    },
    indentationRules: {
      increaseIndentPattern: /^\s*(else|elseif|for|function|if|repeat|while|do|then)\b.*$/,
      decreaseIndentPattern: /^\s*(end|else|elseif|until)\b.*$/,
    },
    wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
  });

  monaco.editor.defineTheme('synvolt-synvolt', luauTheme);
  monaco.editor.defineTheme('synvolt-synviolet', {
    ...luauTheme,
    colors: { ...luauTheme.colors,
      'editor.background': '#171222', 'editorGutter.background': '#171222',
      'editor.lineHighlightBackground': '#2b223a', 'editorWidget.background': '#21192e',
      'editorSuggestWidget.background': '#21192e', 'editorHoverWidget.background': '#21192e',
      'editorWidget.border': '#493b5a', 'editorSuggestWidget.border': '#493b5a', 'editorHoverWidget.border': '#493b5a',
      'editorSuggestWidget.selectedBackground': '#352a47', 'list.hoverBackground': '#352a47',
      'list.activeSelectionBackground': '#352a47', 'list.focusBackground': '#352a47',
    },
  });
  for (const [name, bg, panel, surface, border] of [
    ['midnight', '#0C1626', '#12213A', '#1A2C48', '#3B5271'],
    ['emerald', '#0C1B17', '#122820', '#1A362A', '#3A5F4E'],
    ['crimson', '#201012', '#30191C', '#402226', '#704148'],
    ['graphite', '#151515', '#202020', '#2B2B2B', '#4A4A4A'],
  ]) {
    monaco.editor.defineTheme('synvolt-' + name, { ...luauTheme, colors: { ...luauTheme.colors,
      'editor.background': bg, 'editorGutter.background': bg, 'editor.lineHighlightBackground': surface,
      'editorWidget.background': panel, 'editorSuggestWidget.background': panel, 'editorHoverWidget.background': panel,
      'editorWidget.border': border, 'editorSuggestWidget.border': border, 'editorHoverWidget.border': border,
      'editorSuggestWidget.selectedBackground': surface, 'list.hoverBackground': surface,
    }});
  }
  const creamTheme: Monaco.editor.IStandaloneThemeData = {
    base: 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: '6C7950', fontStyle: 'italic' },
      { token: 'keyword', foreground: '804B83' }, { token: 'string', foreground: '9B5438' },
      { token: 'number', foreground: '59724C' }, { token: 'type', foreground: '336F72' },
      { token: 'type.roblox', foreground: '336D88' }, { token: 'identifier', foreground: '345D75' },
      { token: 'variable.roblox', foreground: '345D75' }, { token: 'variable.service', foreground: '336F72' },
      { token: 'variable.executor', foreground: '30271F' }, { token: 'function.executor', foreground: 'A44646' },
    ],
    colors: { 'editor.background': '#F5EDDD', 'editor.foreground': '#30271F',
      'editorGutter.background': '#F5EDDD', 'editor.lineHighlightBackground': '#EDE1CE',
      'editorLineNumber.foreground': '#9B8A72', 'editorLineNumber.activeForeground': '#514337',
      'editorCursor.foreground': '#514337', 'editor.selectionBackground': '#DCC8A6',
      'editorWidget.background': '#FFF8EB', 'editorWidget.border': '#D2C2AA',
      'editorSuggestWidget.background': '#FFF8EB', 'editorSuggestWidget.border': '#D2C2AA',
      'editorSuggestWidget.foreground': '#30271F', 'editorSuggestWidget.selectedBackground': '#E5D6C0',
      'editorHoverWidget.background': '#FFF8EB', 'editorHoverWidget.border': '#D2C2AA',
    },
  };
  monaco.editor.defineTheme('synvolt-cream', creamTheme);
  monaco.editor.defineTheme('synvolt-sakura', { ...creamTheme, colors: { ...creamTheme.colors,
    'editor.background': '#FBF1F4', 'editorGutter.background': '#FBF1F4', 'editor.lineHighlightBackground': '#F4E3E9',
    'editor.foreground': '#49323D', 'editorWidget.background': '#FFF9FA', 'editorSuggestWidget.background': '#FFF9FA',
    'editorHoverWidget.background': '#FFF9FA', 'editorWidget.border': '#DFBDC9', 'editorSuggestWidget.border': '#DFBDC9',
    'editorHoverWidget.border': '#DFBDC9', 'editorSuggestWidget.selectedBackground': '#EED5DE',
  }});
}
