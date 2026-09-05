import { cleanup } from '@testing-library/react-native';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  const chain: Record<string, unknown> = {};
  chain.duration = () => chain;
  chain.delay = () => chain;
  chain.easing = () => chain;
  chain.reduceMotion = () => chain;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    Easing: {
      bezier: () => (value: number) => value,
      cubic: (value: number) => value,
      out: (easing: (value: number) => number) => easing,
    },
    FadeIn: chain,
    FadeOut: chain,
    LinearTransition: chain,
    ReduceMotion: { System: 'system' },
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    SlideInDown: chain,
    SlideOutDown: chain,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initialValue: unknown) => {
      const shared = {
        value: initialValue,
        get: () => shared.value,
        set: (value: unknown) => {
          shared.value = value;
        },
      };
      return shared;
    },
    withTiming: (value: unknown) => value,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const React = jest.requireActual('react');
  const gesture = new Proxy(
    {},
    {
      get: () => () => gesture,
    },
  );
  return {
    Gesture: { Pan: () => gesture, Pinch: () => gesture },
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    __esModule: true,
    ArrowLeft: Icon,
    BookOpen: Icon,
    Bell: Icon,
    CalendarDays: Icon,
    Camera: Icon,
    ChartNoAxesColumn: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ChevronLeft: Icon,
    Compass: Icon,
    Clock3: Icon,
    EllipsisVertical: Icon,
    Globe2: Icon,
    GripVertical: Icon,
    LayoutGrid: Icon,
    Library: Icon,
    List: Icon,
    ListVideo: Icon,
    LockKeyhole: Icon,
    LogIn: Icon,
    Pencil: Icon,
    Plus: Icon,
    Search: Icon,
    Eye: Icon,
    Film: Icon,
    Square: Icon,
    Settings: Icon,
    SlidersHorizontal: Icon,
    Star: Icon,
    Tags: Icon,
    Tv2: Icon,
    UserPlus: Icon,
    UserRound: Icon,
    Trash2: Icon,
    X: Icon,
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalError = console.error;

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const message = String(args[0]);
    originalError(...args);
    throw new Error(`Unexpected console.error: ${message}`);
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});

afterEach(async () => {
  await cleanup();
});
