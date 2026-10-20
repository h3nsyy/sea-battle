window.CONFIG = {
  DEBUG: true,
  BOARD_SIZE: 10,
  CODE_LENGTH: 6,
  DEFAULT_NAME: 'игрок',
  FLEET_DEF: [
    { size: 4, count: 1 },
    { size: 3, count: 2 },
    { size: 2, count: 3 },
    { size: 1, count: 4 }
  ],
  PEER_CONFIG: {
    host: 'sea-battle-peer-server.onrender.com',
    port: 443,
    path: '/peerjs',
    secure: true,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceTransportPolicy: 'all'
    }
  },
  TIMEOUTS: {
    CONNECT_MS: 10000,
    PEER_OPEN_MS: 45000,
    WAKE_MS: 8000,
    TOAST_MS: 5000,
    SHAKE_MS: 350
  },
  SOUNDS: {
    yay: 'sounds/yay.mp3',
    sad: 'sounds/sad.mp3'
  },
  DOM_IDS: {
    themeToggle: 'themeToggle',
    screenLobby: 'screen-lobby',
    screenSetup: 'screen-setup',
    screenBattle: 'screen-battle',
    lobbyStart: 'lobbyStart',
    lobbyHost: 'lobbyHost',
    lobbyStatus: 'lobbyStatus',
    lobbyStatusText: 'lobbyStatusText',
    nickname: 'nicknameInput',
    joinInput: 'joinInput',
    btnCreate: 'btnCreate',
    btnJoin: 'btnJoin',
    btnCancelHost: 'btnCancelHost',
    hostId: 'hostId',
    setupBoard: 'setupBoard',
    fleetList: 'fleetList',
    btnRotate: 'btnRotate',
    btnUndo: 'btnUndo',
    btnRandom: 'btnRandom',
    btnReady: 'btnReady',
    setupControls: 'setupControls',
    setupWait: 'setupWait',
    turnText: 'turnText',
    enemyBoard: 'enemyBoard',
    myBoard: 'myBoard',
    overlayWin: 'overlayWin',
    winTitle: 'winTitle',
    winDesc: 'winDesc',
    btnRestart: 'btnRestart',
    rematchWait: 'rematchWait',
    modal: 'modal',
    modalTitle: 'modalTitle',
    modalText: 'modalText',
    modalBtn: 'modalBtn',
    toasts: 'toasts'
  }
};
