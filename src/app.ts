import { TextEditor, File, Disposable } from 'atom';
import * as path from 'path';
import View from './view';
import { validator, loadFile } from './validator';
import { Shader, SoundShader, OscData, Pass } from './constants';
import Config, { RcDiff } from './config';
import { Playable } from './playable';
import Player from './player';
import PlayerServer from './player-server';
import { INITIAL_SHADER, INITIAL_SOUND_SHADER } from './constants';
import OscLoader from './osc-loader';
import Recorder, { RecordingMode } from './recorder';
import * as glslify from 'glslify-lite';
import * as prebuilt from 'glslang-validator-prebuilt';
import { saveAllTextEditor } from './utils';

interface AppState {
    isPlaying: boolean;
    activeEditorDisposer?: Disposable;
    editorDisposer?: Disposable;
    editor?: TextEditor;
}

type LOADING_METHOD = 'editor' | 'project';

export default class App {
    private player: Playable;
    private view: View | null = null;
    private state: AppState;
    private glslangValidatorPath: string = prebuilt.path;
    private lastShader: Shader = INITIAL_SHADER;
    private lastSoundShader: SoundShader = INITIAL_SOUND_SHADER;
    private osc: OscLoader | null = null;
    private recorder: Recorder = new Recorder();

    private config: Config;

    private loadingMethod: LOADING_METHOD;
    private projectFileName: string;

    public constructor(config: Config) {
        const rc = config.rc;
        this.view = new View((atom.workspace as any).getElement()); // eslint-disable-line
        this.player = new Player(this.view, rc, false, this.lastShader);

        this.config = config;
        this.config.on('change', this.onChange);

        this.loadingMethod = 'project';
        this.projectFileName = 'index.frag';

        this.state = {
            isPlaying: false,
        };
    }

    public destroy(): void {
        this.player.destroy();
        if (this.osc) {
            this.osc.destroy();
        }
    }

    private onAnyChanges = ({ added }: RcDiff): void => {
        if (added.glslangValidatorPath) {
            this.glslangValidatorPath = added.glslangValidatorPath;
        }

        if (added.server !== undefined) {
            if (this.player) {
                this.player.command({ type: 'STOP' });
            }

            const rc = this.config.createRc();

            if (added.server) {
                if (this.view !== null) {
                    this.view.destroy();
                }
                this.player = new PlayerServer(added.server, {
                    rc,
                    isPlaying: this.state.isPlaying,
                    projectPath: this.config.projectPath,
                    lastShader: this.lastShader,
                });
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.view = new View((atom.workspace as any).element);
                this.player = new Player(
                    this.view,
                    rc,
                    this.state.isPlaying,
                    this.lastShader,
                );
            }
        }

        if (added.osc !== undefined) {
            const port = added.osc;
            const osc = this.osc;
            if (osc && (!port || osc.port !== parseInt(port.toString(), 10))) {
                osc.destroy();
                this.osc = null;
            }
            if (port && !this.osc) {
                const oscLoader = new OscLoader(port);
                this.osc = oscLoader;
                oscLoader.on('message', this.onOsc);
                oscLoader.on('reload', (): void => this.loadLastShader());
            }
        }
    };

    private onChange = (rcDiff: RcDiff): void => {
        this.onAnyChanges(rcDiff);
        this.player.onChange(rcDiff);
        this.loadLastShader();
        this.loadLastSoundShader();
    };

    private onOsc = (data: OscData): void => {
        this.player.command({ type: 'SET_OSC', data });
    };

    public toggle(): void {
        return this.state.isPlaying ? this.stop() : this.play();
    }

    public play(): void {
        this.state.isPlaying = true;
        this.player.command({ type: 'PLAY' });
        this.config.play();
    }

    public stop(): void {
        this.state.isPlaying = false;
        this.player.command({ type: 'STOP' });
        this.player.command({ type: 'STOP_SOUND' });
        this.config.stop();
        this.stopWatching();
        this.stopRecording();
    }

    public watchActiveShader(): void {
        if (this.state.activeEditorDisposer) {
            return;
        }

        this.watchShader();
        this.state.activeEditorDisposer = atom.workspace.onDidChangeActiveTextEditor(
            (): void => {
                this.watchShader();
            },
        );
    }

    public watchShader(): void {
        if (this.state.editorDisposer) {
            this.state.editorDisposer.dispose();
            this.state.editorDisposer = undefined;
        }

        if (this.loadingMethod === 'editor') {
            const editor = atom.workspace.getActiveTextEditor();
            this.state.editor = editor;
            this.loadShaderOfEditor(editor);
            if (editor !== undefined) {
                this.state.editorDisposer = editor.onDidStopChanging(
                    (): void => {
                        this.loadShaderOfEditor(editor);
                    },
                );
            }
        } else {
            this.loadShaderOfProject(this.config.projectPath);
        }
    }

    public loadShader(): void {
        if (this.loadingMethod === 'editor') {
            const editor = atom.workspace.getActiveTextEditor();
            this.loadShaderOfEditor(editor);
        } else {
            this.loadShaderOfProject(this.config.projectPath);
        }
    }

    public loadSoundShader(): Promise<void> {
        const editor = atom.workspace.getActiveTextEditor();
        return this.loadShaderOfEditor(editor, true);
    }

    public playSound(): void {
        this.loadSoundShader().then((): void =>
            this.player.command({ type: 'PLAY_SOUND' }),
        );
    }

    public stopSound(): void {
        this.player.command({ type: 'STOP_SOUND' });
    }

    private loadLastShader(): void {
        if (!this.lastShader) {
            return;
        }
        this.player.command({ type: 'LOAD_SHADER', shader: this.lastShader });
    }

    private loadLastSoundShader(): void {
        if (!this.lastSoundShader) {
            return;
        }
        this.player.command({
            type: 'LOAD_SOUND_SHADER',
            shader: this.lastSoundShader,
        });
    }

    public stopWatching(): void {
        this.state.editor = undefined;
        if (this.state.activeEditorDisposer) {
            this.state.activeEditorDisposer.dispose();
            this.state.activeEditorDisposer = undefined;
        }
        if (this.state.editorDisposer) {
            this.state.editorDisposer.dispose();
            this.state.editorDisposer = undefined;
        }
    }

    private createPasses(
        rcPasses: Pass[],
        shader: string,
        postfix: string,
        dirname: string,
    ): Promise<Pass[]> {
        if (rcPasses.length === 0) {
            rcPasses.push({});
        }

        const lastPass = rcPasses.length - 1;

        return Promise.all(
            rcPasses.map(
                async (rcPass: Pass, i: number): Promise<Pass> => {
                    const pass: Pass = {
                        MODEL: rcPass.MODEL,
                        TARGET: rcPass.TARGET,
                        FLOAT: rcPass.FLOAT,
                        WIDTH: rcPass.WIDTH,
                        HEIGHT: rcPass.HEIGHT,
                        BLEND: rcPass.BLEND,
                    };

                    if (!rcPass.fs && !rcPass.vs) {
                        if (postfix === '.vert' || postfix === '.vs') {
                            pass.vs = shader;
                        } else {
                            pass.fs = shader;
                        }
                    } else {
                        if (rcPass.vs) {
                            pass.vs = await loadFile(
                                this.glslangValidatorPath,
                                path.resolve(dirname, rcPass.vs),
                            );
                            if (
                                i === lastPass &&
                                (postfix === '.frag' || postfix === '.fs')
                            ) {
                                pass.fs = shader;
                            }
                        }
                        if (rcPass.fs) {
                            pass.fs = await loadFile(
                                this.glslangValidatorPath,
                                path.resolve(dirname, rcPass.fs),
                            );
                            if (
                                i === lastPass &&
                                (postfix === '.vert' || postfix === '.vs')
                            ) {
                                pass.vs = shader;
                            }
                        }
                    }

                    return pass;
                },
            ),
        );
    }

    private async loadShaderOfEditor(
        editor?: TextEditor,
        isSound?: boolean,
    ): Promise<void> {
        if (editor === undefined) {
            // This case occurs when no files are open/active
            return Promise.resolve();
        }
        const filepath = editor.getPath();
        if (filepath === undefined) {
            return Promise.resolve();
        }

        const dirname = path.dirname(filepath);

        const m = (filepath || '').match(/(\.(?:glsl|frag|vert|fs|vs))$/);
        if (!m) {
            console.error("The filename for current doesn't seems to be GLSL.");
            return Promise.resolve();
        }
        const postfix = m[1];

        let shader = editor.getText();

        try {
            // Detect changes of settings
            let headComment = (shader.match(
                /(?:\/\*)((?:.|\n|\r|\n\r)*?)(?:\*\/)/,
            ) || [])[1];
            headComment = headComment || '{}'; // suppress JSON5 parse errors

            let diff;
            if (isSound) {
                diff = this.config.setSoundSettingsByString(
                    filepath,
                    headComment,
                );
            } else {
                diff = this.config.setFileSettingsByString(
                    filepath,
                    headComment,
                );
            }
            const rc = diff.newConfig;
            this.onAnyChanges(diff);
            this.player.onChange(diff);

            // Compile the shader with glslify-lite
            if (rc.glslify) {
                shader = await glslify.compile(shader, {
                    basedir: path.dirname(filepath),
                });
            }

            // Validate compiled shader
            if (!isSound) {
                await validator(this.glslangValidatorPath, shader, postfix);
            }

            const passes = await this.createPasses(
                rc.PASSES,
                shader,
                postfix,
                dirname,
            );

            if (isSound) {
                this.lastSoundShader = shader;
                return this.player.command({
                    type: 'LOAD_SOUND_SHADER',
                    shader,
                });
            } else {
                this.lastShader = passes;
                return this.player.command({
                    type: 'LOAD_SHADER',
                    shader: passes,
                });
            }
        } catch (e) {
            console.error(e);
        }
    }

    private async loadShaderOfProject(
        projectPath?: string,
        isSound?: boolean,
    ): Promise<void> {
        if (projectPath === undefined) {
            // This case occurs when no files are open/active
            return Promise.resolve();
        }

        // get filePath
        const filepath = projectPath + '/' + this.projectFileName;
        const dirname = path.dirname(filepath);
        const m = (filepath || '').match(/(\.(?:glsl|frag|vert|fs|vs))$/);
        if (!m) {
            console.error("The filename for current doesn't seems to be GLSL.");
            return Promise.resolve();
        }
        const postfix = m[1];

        // save all textEditor file
        saveAllTextEditor()
            .then(() => {
                // load shader
                const file = new File(filepath);
                file.read()
                    .then(async value => {
                        try {
                            let shader = value;
                            console.log('file.read() success. ¥n' + shader);
                            if (!shader) {
                                console.error(filepath + ' is not found.');
                                return Promise.resolve();
                            }

                            // Detect changes of settings
                            let headComment = (shader.match(
                                /(?:\/\*)((?:.|\n|\r|\n\r)*?)(?:\*\/)/,
                            ) || [])[1];
                            headComment = headComment || '{}'; // suppress JSON5 parse errors

                            let diff;
                            if (isSound) {
                                diff = this.config.setSoundSettingsByString(
                                    filepath,
                                    headComment,
                                );
                            } else {
                                diff = this.config.setFileSettingsByString(
                                    filepath,
                                    headComment,
                                );
                            }
                            const rc = diff.newConfig;
                            this.onAnyChanges(diff);
                            this.player.onChange(diff);

                            // Compile the shader with glslify-lite
                            if (rc.glslify) {
                                shader = await glslify.compile(shader, {
                                    basedir: path.dirname(filepath),
                                });
                            }

                            // Validate compiled shader
                            if (!isSound) {
                                await validator(
                                    this.glslangValidatorPath,
                                    shader,
                                    postfix,
                                );
                            }

                            const passes = await this.createPasses(
                                rc.PASSES,
                                shader,
                                postfix,
                                dirname,
                            );

                            if (isSound) {
                                this.lastSoundShader = shader;
                                return this.player.command({
                                    type: 'LOAD_SOUND_SHADER',
                                    shader,
                                });
                            } else {
                                this.lastShader = passes;
                                return this.player.command({
                                    type: 'LOAD_SHADER',
                                    shader: passes,
                                });
                            }
                        } catch (e) {
                            console.error(e);
                        }
                    })
                    .catch(e => {
                        console.error('file read error. ', e);
                        return Promise.resolve();
                    });
            })
            .catch(e => {
                console.error('save textEditor error. ', e);
                return Promise.resolve();
            });
    }

    public toggleFullscreen(): void {
        this.player.command({ type: 'TOGGLE_FULLSCREEN' });
    }

    public async startRecording(): Promise<void> {
        if (this.view === null) {
            return;
        }
        const canvas = this.view.getCanvas();
        const fps = 60 / this.config.rc.frameskip;
        const width = canvas.offsetWidth; // We don't consider pixelRatio here so that outputs don't get gigantic
        const height = canvas.offsetHeight;
        const dst = this.config.projectPath;

        this.player.command({ type: 'START_RECORDING' });
        this.recorder.start(canvas, fps, width, height, dst);
    }

    public async stopRecording(): Promise<void> {
        this.recorder.stop();
        this.player.command({ type: 'STOP_RECORDING' });
    }

    public setRecordingMode(mode: RecordingMode): void {
        this.recorder.setRecordingMode(mode);
    }

    public setLoadingMethod(method: LOADING_METHOD): void {
        this.loadingMethod = method;
        console.log('loadingMethod is ' + this.loadingMethod);
    }
    public setProjectFileName(fileName: string): void {
        this.projectFileName = fileName;
    }
}
