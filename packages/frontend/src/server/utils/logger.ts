import winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';
import { getMioBridgeBaseDir } from '../runtimePaths';

// 获取日志级别 - 使用默认值避免循环依赖
const getLogLevel = (): string => {
    try {
        // 延迟导入以避免循环依赖
        const { getLogLevel } = require('../config/index');
        return getLogLevel();
    } catch {
        return 'info'; // 默认日志级别
    }
};

// 获取日志目录 - 使用默认值避免循环依赖
const getLogDir = (): string => {
    try {
        const { config } = require('../config');
        return config.logDir;
    } catch {
        return path.join(getMioBridgeBaseDir(), 'log');
    }
};

const logDir = getLogDir();
try {
    fs.mkdirSync(logDir, { recursive: true });
} catch {
    // File transports may be unavailable in restricted runtimes; console logging still works.
}

const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
        return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
    })
);

export const logger = winston.createLogger({
    level: getLogLevel(),
    format: logFormat,
    defaultMeta: { service: 'miobridge' },
    transports: [
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5
        })
    ]
});

// 获取应用环境
const getAppEnvironment = (): string => {
    try {
        // 延迟导入以避免循环依赖
        const { getAppEnvironment } = require('../config/index');
        return getAppEnvironment();
    } catch {
        return 'production';
    }
};

const appEnvironment = getAppEnvironment();
if (appEnvironment !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        ),
        level: 'debug'
    }));
} else {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

export default logger;
