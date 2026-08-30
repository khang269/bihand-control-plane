import React from 'react';
import { Bot, MessageSquareOff } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface ChatUnavailablePlaceholderProps {
  agentType: string;
}

export const ChatUnavailablePlaceholder: React.FC<ChatUnavailablePlaceholderProps> = ({ agentType }) => {
  const { language } = useLanguage();

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card flex flex-col h-full min-h-0">
      <div className="bg-secondary border-b border-border p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
          <Bot size={16} /> Live Chat
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-muted-foreground" />
          {language === 'vi' ? 'Không khả dụng' : 'Unavailable'}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground mb-4">
          <MessageSquareOff size={24} />
        </div>
        <p className="text-sm text-foreground font-semibold max-w-sm">
          {language === 'vi'
            ? `Trò chuyện trực tiếp chưa khả dụng cho tác nhân loại "${agentType}".`
            : `Live chat isn't available for "${agentType}" agents yet.`}
        </p>
        <p className="text-xs text-muted-foreground mt-2 max-w-sm">
          {language === 'vi'
            ? 'Mở bảng Cài đặt để xem cấu hình, hướng dẫn và lịch sử chạy của tác nhân này.'
            : 'Open the Settings drawer to review this agent’s configuration, instructions, and run history instead.'}
        </p>
      </div>
    </div>
  );
};

export default ChatUnavailablePlaceholder;
