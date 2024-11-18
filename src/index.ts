/**
 * @license
 * Copyright 2018 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import camelCase = require('lodash.camelcase');
import * as Protobuf from 'protobufjs';
import * as descriptor from 'protobufjs/ext/descriptor';

import { loadProtosWithOptionsSync, loadProtosWithOptions, Options, addCommonProtos } from './util';

import Long = require('long');

export { Options, Long };

/**
 * This type exists for use with code generated by the proto-loader-gen-types
 * tool. This type should be used with another interface, e.g.
 * MessageType & AnyExtension for an object that is converted to or from a
 * google.protobuf.Any message.
 * For example, when processing an Any message:
 *
 * ```ts
 * if (isAnyExtension(message)) {
 *   switch (message['@type']) {
 *     case TYPE1_URL:
 *       handleType1(message as AnyExtension & Type1);
 *       break;
 *     case TYPE2_URL:
 *       handleType2(message as AnyExtension & Type2);
 *       break;
 *     // ...
 *   }
 * }
 * ```
 */
export interface AnyExtension {
  /**
   * The fully qualified name of the message type that this object represents,
   * possibly including a URL prefix.
   */
  '@type': string;
}

export function isAnyExtension(obj: object): obj is AnyExtension {
  return ('@type' in obj) && (typeof (obj as AnyExtension)['@type'] === 'string');
}

declare module 'protobufjs' {
  interface Type {
    toDescriptor(
      protoVersion: string
    ): Protobuf.Message<descriptor.IDescriptorProto> &
      descriptor.IDescriptorProto;
  }

  interface RootConstructor {
    new (options?: Options): Root;
    fromDescriptor(
      descriptorSet:
        | descriptor.IFileDescriptorSet
        | Protobuf.Reader
        | Uint8Array
    ): Root;
    fromJSON(json: Protobuf.INamespace, root?: Root): Root;
  }

  interface Root {
    toDescriptor(
      protoVersion: string
    ): Protobuf.Message<descriptor.IFileDescriptorSet> &
      descriptor.IFileDescriptorSet;
  }

  interface Enum {
    toDescriptor(
      protoVersion: string
    ): Protobuf.Message<descriptor.IEnumDescriptorProto> &
      descriptor.IEnumDescriptorProto;
  }
}

export interface Serialize<T> {
  (value: T): Buffer;
}

export interface Deserialize<T> {
  (bytes: Buffer): T;
}

export interface ProtobufTypeDefinition {
  format: string;
  type: object;
  fileDescriptorProtos: Buffer[];
}

export interface MessageTypeDefinition extends ProtobufTypeDefinition {
  format: 'Protocol Buffer 3 DescriptorProto';
}

export interface EnumTypeDefinition extends ProtobufTypeDefinition {
  format: 'Protocol Buffer 3 EnumDescriptorProto';
}

export enum IdempotencyLevel {
  IDEMPOTENCY_UNKNOWN = 'IDEMPOTENCY_UNKNOWN',
  NO_SIDE_EFFECTS = 'NO_SIDE_EFFECTS',
  IDEMPOTENT = 'IDEMPOTENT'
}

export interface NamePart {
  name_part: string;
  is_extension: boolean;
}

export interface UninterpretedOption {
  name?: NamePart[];
  identifier_value?: string;
  positive_int_value?: number;
  negative_int_value?: number;
  double_value?: number;
  string_value?: string;
  aggregate_value?: string;
}

export interface MethodOptions {
  deprecated: boolean;
  idempotency_level: IdempotencyLevel;
  uninterpreted_option: UninterpretedOption[];
  [k: string]: unknown;
}

export interface MethodDefinition<RequestType, ResponseType, OutputRequestType=RequestType, OutputResponseType=ResponseType> {
  path: string;
  requestStream: boolean;
  responseStream: boolean;
  requestSerialize: Serialize<RequestType>;
  responseSerialize: Serialize<ResponseType>;
  requestDeserialize: Deserialize<OutputRequestType>;
  responseDeserialize: Deserialize<OutputResponseType>;
  originalName?: string;
  requestType: MessageTypeDefinition;
  responseType: MessageTypeDefinition;
  options: MethodOptions;
}

export interface ServiceDefinition {
  [index: string]: MethodDefinition<object, object>;
}

export type AnyDefinition =
  | ServiceDefinition
  | MessageTypeDefinition
  | EnumTypeDefinition;

export interface PackageDefinition {
  [index: string]: AnyDefinition;
}

type DecodedDescriptorSet = Protobuf.Message<descriptor.IFileDescriptorSet> &
  descriptor.IFileDescriptorSet;

const descriptorOptions: Protobuf.IConversionOptions = {
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
  oneofs: true,
  json: true,
};

function joinName(baseName: string, name: string): string {
  if (baseName === '') {
    return name;
  } else {
    return baseName + '.' + name;
  }
}

type HandledReflectionObject = Protobuf.Service | Protobuf.Type | Protobuf.Enum;

function isHandledReflectionObject(
  obj: Protobuf.ReflectionObject
): obj is HandledReflectionObject {
  return (
    obj instanceof Protobuf.Service ||
    obj instanceof Protobuf.Type ||
    obj instanceof Protobuf.Enum
  );
}

function isNamespaceBase(
  obj: Protobuf.ReflectionObject
): obj is Protobuf.NamespaceBase {
  return obj instanceof Protobuf.Namespace || obj instanceof Protobuf.Root;
}

function getAllHandledReflectionObjects(
  obj: Protobuf.ReflectionObject,
  parentName: string
): Array<[string, HandledReflectionObject]> {
  const objName = joinName(parentName, obj.name);
  if (isHandledReflectionObject(obj)) {
    return [[objName, obj]];
  } else {
    if (isNamespaceBase(obj) && typeof obj.nested !== 'undefined') {
      return Object.keys(obj.nested!)
        .map(name => {
          return getAllHandledReflectionObjects(obj.nested![name], objName);
        })
        .reduce(
          (accumulator, currentValue) => accumulator.concat(currentValue),
          []
        );
    }
  }
  return [];
}

function createDeserializer(
  cls: Protobuf.Type,
  options: Options
): Deserialize<object> {
  return function deserialize(argBuf: Buffer): object {
    return cls.toObject(cls.decode(argBuf), options);
  };
}

function createSerializer(cls: Protobuf.Type): Serialize<object> {
  return function serialize(arg: object): Buffer {
    if (Array.isArray(arg)) {
      throw new Error(`Failed to serialize message: expected object with ${cls.name} structure, got array instead`);
    }
    const message = cls.fromObject(arg);
    return cls.encode(message).finish() as Buffer;
  };
}

function mapMethodOptions(options: Partial<MethodOptions>[] | undefined): MethodOptions {
  return (options || []).reduce((obj: MethodOptions, item: Partial<MethodOptions>) => {
    for (const [key, value] of Object.entries(item)) {
      switch (key) {
        case 'uninterpreted_option' :
          obj.uninterpreted_option.push(item.uninterpreted_option as UninterpretedOption);
          break;
        default:
          obj[key] = value
      }
    }
    return obj
  },
    {
      deprecated: false,
      idempotency_level: IdempotencyLevel.IDEMPOTENCY_UNKNOWN,
      uninterpreted_option: [],
    }
  ) as MethodOptions;
}

function createMethodDefinition(
  method: Protobuf.Method,
  serviceName: string,
  options: Options,
  fileDescriptors: Buffer[]
): MethodDefinition<object, object> {
  /* This is only ever called after the corresponding root.resolveAll(), so we
   * can assume that the resolved request and response types are non-null */
  const requestType: Protobuf.Type = method.resolvedRequestType!;
  const responseType: Protobuf.Type = method.resolvedResponseType!;
  return {
    path: '/' + serviceName + '/' + method.name,
    requestStream: !!method.requestStream,
    responseStream: !!method.responseStream,
    requestSerialize: createSerializer(requestType),
    requestDeserialize: createDeserializer(requestType, options),
    responseSerialize: createSerializer(responseType),
    responseDeserialize: createDeserializer(responseType, options),
    // TODO(murgatroid99): Find a better way to handle this
    originalName: camelCase(method.name),
    requestType: createMessageDefinition(requestType, fileDescriptors),
    responseType: createMessageDefinition(responseType, fileDescriptors),
    options: mapMethodOptions(method.parsedOptions),
  };
}

function createServiceDefinition(
  service: Protobuf.Service,
  name: string,
  options: Options,
  fileDescriptors: Buffer[]
): ServiceDefinition {
  const def: ServiceDefinition = {};
  for (const method of service.methodsArray) {
    def[method.name] = createMethodDefinition(
      method,
      name,
      options,
      fileDescriptors
    );
  }
  return def;
}

function createMessageDefinition(
  message: Protobuf.Type,
  fileDescriptors: Buffer[]
): MessageTypeDefinition {
  const messageDescriptor: protobuf.Message<
    descriptor.IDescriptorProto
  > = message.toDescriptor('proto3');
  return {
    format: 'Protocol Buffer 3 DescriptorProto',
    type: messageDescriptor.$type.toObject(
      messageDescriptor,
      descriptorOptions
    ),
    fileDescriptorProtos: fileDescriptors,
  };
}

function createEnumDefinition(
  enumType: Protobuf.Enum,
  fileDescriptors: Buffer[]
): EnumTypeDefinition {
  const enumDescriptor: protobuf.Message<
    descriptor.IEnumDescriptorProto
  > = enumType.toDescriptor('proto3');
  return {
    format: 'Protocol Buffer 3 EnumDescriptorProto',
    type: enumDescriptor.$type.toObject(enumDescriptor, descriptorOptions),
    fileDescriptorProtos: fileDescriptors,
  };
}

/**
 * function createDefinition(obj: Protobuf.Service, name: string, options:
 * Options): ServiceDefinition; function createDefinition(obj: Protobuf.Type,
 * name: string, options: Options): MessageTypeDefinition; function
 * createDefinition(obj: Protobuf.Enum, name: string, options: Options):
 * EnumTypeDefinition;
 */
function createDefinition(
  obj: HandledReflectionObject,
  name: string,
  options: Options,
  fileDescriptors: Buffer[]
): AnyDefinition {
  if (obj instanceof Protobuf.Service) {
    return createServiceDefinition(obj, name, options, fileDescriptors);
  } else if (obj instanceof Protobuf.Type) {
    return createMessageDefinition(obj, fileDescriptors);
  } else if (obj instanceof Protobuf.Enum) {
    return createEnumDefinition(obj, fileDescriptors);
  } else {
    throw new Error('Type mismatch in reflection object handling');
  }
}

function createPackageDefinition(
  root: Protobuf.Root,
  options: Options
): PackageDefinition {
  const def: PackageDefinition = {};
  root.resolveAll();
  const descriptorList: descriptor.IFileDescriptorProto[] = root.toDescriptor(
    'proto3'
  ).file;
  const bufferList: Buffer[] = descriptorList.map(value =>
    Buffer.from(descriptor.FileDescriptorProto.encode(value).finish())
  );
  for (const [name, obj] of getAllHandledReflectionObjects(root, '')) {
    def[name] = createDefinition(obj, name, options, bufferList);
  }
  return def;
}

function createPackageDefinitionFromDescriptorSet(
  decodedDescriptorSet: DecodedDescriptorSet,
  options?: Options
) {
  options = options || {};

  const root = (Protobuf.Root as Protobuf.RootConstructor).fromDescriptor(
    decodedDescriptorSet
  );
  root.resolveAll();
  return createPackageDefinition(root, options);
}

/**
 * Load a .proto file with the specified options.
 * @param filename One or multiple file paths to load. Can be an absolute path
 *     or relative to an include path.
 * @param options.keepCase Preserve field names. The default is to change them
 *     to camel case.
 * @param options.longs The type that should be used to represent `long` values.
 *     Valid options are `Number` and `String`. Defaults to a `Long` object type
 *     from a library.
 * @param options.enums The type that should be used to represent `enum` values.
 *     The only valid option is `String`. Defaults to the numeric value.
 * @param options.bytes The type that should be used to represent `bytes`
 *     values. Valid options are `Array` and `String`. The default is to use
 *     `Buffer`.
 * @param options.defaults Set default values on output objects. Defaults to
 *     `false`.
 * @param options.arrays Set empty arrays for missing array values even if
 *     `defaults` is `false`. Defaults to `false`.
 * @param options.objects Set empty objects for missing object values even if
 *     `defaults` is `false`. Defaults to `false`.
 * @param options.oneofs Set virtual oneof properties to the present field's
 *     name
 * @param options.json Represent Infinity and NaN as strings in float fields,
 *     and automatically decode google.protobuf.Any values.
 * @param options.includeDirs Paths to search for imported `.proto` files.
 */
export function load(
  filename: string | string[],
  options?: Options
): Promise<PackageDefinition> {
  return loadProtosWithOptions(filename, options).then(loadedRoot => {
    return createPackageDefinition(loadedRoot, options!);
  });
}

export function loadSync(
  filename: string | string[],
  options?: Options
): PackageDefinition {
  const loadedRoot = loadProtosWithOptionsSync(filename, options);
  return createPackageDefinition(loadedRoot, options!);
}

export function fromJSON(
  json: Protobuf.INamespace,
  options?: Options
): PackageDefinition {
  options = options || {};
  const loadedRoot = Protobuf.Root.fromJSON(json);
  loadedRoot.resolveAll();
  return createPackageDefinition(loadedRoot, options!);
}

export function loadFileDescriptorSetFromBuffer(
  descriptorSet: Buffer,
  options?: Options
): PackageDefinition {
  const decodedDescriptorSet = descriptor.FileDescriptorSet.decode(
    descriptorSet
  ) as DecodedDescriptorSet;

  return createPackageDefinitionFromDescriptorSet(
    decodedDescriptorSet,
    options
  );
}

export function loadFileDescriptorSetFromObject(
  descriptorSet: Parameters<typeof descriptor.FileDescriptorSet.fromObject>[0],
  options?: Options
): PackageDefinition {
  const decodedDescriptorSet = descriptor.FileDescriptorSet.fromObject(
    descriptorSet
  ) as DecodedDescriptorSet;

  return createPackageDefinitionFromDescriptorSet(
    decodedDescriptorSet,
    options
  );
}

addCommonProtos();