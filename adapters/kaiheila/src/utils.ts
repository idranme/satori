import { Adapter, Author, Bot, Guild, MessageBase, Session, User } from '@satorijs/core'
import { camelize, Schema } from '@satorijs/env-node'
import segment from '@satorijs/message'
import * as Kook from './types'

export interface AdapterConfig extends Adapter.WsClient.Config {
  path?: string
}

export const AdapterConfig: Schema<AdapterConfig> = Schema.intersect([
  Schema.object({
    path: Schema.string().description('服务器监听的路径，仅用于 http 协议。').default('/kaiheila'),
  }),
  Adapter.WsClient.Config,
])

export const adaptGroup = (data: Kook.Guild): Guild => ({
  guildId: data.id,
  guildName: data.name,
})

export const adaptUser = (user: Kook.User): User => ({
  userId: user.id,
  avatar: user.avatar,
  username: user.username,
  discriminator: user.identify_num,
})

export const adaptAuthor = (author: Kook.Author): Author => ({
  ...adaptUser(author),
  nickname: author.nickname,
})

function adaptMessage(base: Kook.MessageBase, meta: Kook.MessageMeta, session: MessageBase = {}) {
  if (meta.author) {
    session.author = adaptAuthor(meta.author)
    session.userId = meta.author.id
  }
  if (base.type === Kook.Type.text) {
    session.content = base.content
      .replace(/@(.+?)#(\d+)/, (_, $1, $2) => segment.at($2, { name: $1 }))
      .replace(/@全体成员/, () => `[CQ:at,type=all]`)
      .replace(/@在线成员/, () => `[CQ:at,type=here]`)
      .replace(/@role:(\d+);/, (_, $1) => `[CQ:at,role=${$1}]`)
      .replace(/#channel:(\d+);/, (_, $1) => segment.sharp($1))
  } else if (base.type === Kook.Type.image) {
    session.content = segment('image', { url: base.content, file: meta.attachments.name })
  }
  return session
}

function adaptMessageSession(data: Kook.Data, meta: Kook.MessageMeta, session: Partial<Session> = {}) {
  adaptMessage(data, meta, session)
  session.messageId = data.msg_id
  session.timestamp = data.msg_timestamp
  const subtype = data.channel_type === 'GROUP' ? 'group' : 'private'
  session.subtype = subtype
  if (meta.quote) {
    session.quote = adaptMessage(meta.quote, meta.quote)
    session.quote.messageId = meta.quote.id
    session.quote.channelId = session.channelId
    session.quote.subtype = subtype
  }
  return session
}

function adaptMessageCreate(data: Kook.Data, meta: Kook.MessageExtra, session: Partial<Session>) {
  adaptMessageSession(data, meta, session)
  session.guildId = meta.guild_id
  session.channelName = meta.channel_name
  if (data.channel_type === 'GROUP') {
    session.subtype = 'group'
    session.channelId = data.target_id
  } else {
    session.subtype = 'private'
    session.channelId = meta.code
  }
}

function adaptMessageModify(data: Kook.Data, meta: Kook.NoticeBody, session: Partial<Session>) {
  adaptMessageSession(data, meta, session)
  session.messageId = meta.msg_id
  session.channelId = meta.channel_id
}

function adaptReaction(body: Kook.NoticeBody, session: Partial<Session>) {
  session.channelId = body.channel_id
  session.messageId = body.msg_id
  session.userId = body.user_id
  session['emoji'] = body.emoji.id
}

export function adaptSession(bot: Bot, input: any) {
  const data: any = {}
  for (const key in input) {
    data[camelize(key)] = input[key]
  }
  const session = bot.session()
  if (data.type === Kook.Type.system) {
    const { type, body } = data.extra as Kook.Notice
    switch (type) {
      case 'updated_message':
      case 'updated_private_message':
        session.type = 'message-updated'
        adaptMessageModify(data, body, session)
        break
      case 'deleted_message':
      case 'deleted_private_message':
        session.type = 'message-deleted'
        adaptMessageModify(data, body, session)
        break
      case 'added_reaction':
      case 'private_added_reaction':
        session.type = 'reaction-added'
        adaptReaction(body, session)
        break
      case 'deleted_reaction':
      case 'private_deleted_reaction':
        session.type = 'reaction-deleted'
        adaptReaction(body, session)
        break
      default: return
    }
  } else {
    session.type = 'message'
    adaptMessageCreate(data, data.extra as Kook.MessageExtra, session)
    if (!session.content) return
  }
  return session
}
