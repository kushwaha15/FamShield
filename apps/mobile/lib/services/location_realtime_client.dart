import 'package:socket_io_client/socket_io_client.dart' as socket_io;

import 'auth_api.dart';

abstract interface class LocationRealtimeSubscription {
  void dispose();
}

abstract interface class LocationRealtimeClient {
  Future<LocationRealtimeSubscription> subscribe({
    required String familyId,
    required void Function() onChanged,
    required void Function() onInvalidated,
  });
}

class SocketIoLocationRealtimeClient implements LocationRealtimeClient {
  const SocketIoLocationRealtimeClient(this._authApi);

  final AuthApi _authApi;

  @override
  Future<LocationRealtimeSubscription> subscribe({
    required String familyId,
    required void Function() onChanged,
    required void Function() onInvalidated,
  }) async {
    final token = await _authApi.readAccessToken();
    if (token == null) throw StateError('An authenticated session is required.');

    final apiUri = _authApi.apiBaseUri;
    final socketPath = apiUri.path.replaceFirst(RegExp(r'/api/?$'), '');
    final socketUri = apiUri.replace(
      path: socketPath.isEmpty ? '/' : socketPath,
      query: null,
      fragment: null,
    );
    final socket = socket_io.io(
      socketUri.toString(),
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .setAuth({'accessToken': token})
          .build(),
    );
    socket.onConnect((_) {
      socket.emitWithAck(
        'location:subscribe',
        {'familyId': familyId},
        ack: (dynamic response) {
          if (response is! Map || response['ok'] != true) {
            socket.disconnect();
          }
        },
      );
    });
    socket.on('location:changed', (_) => onChanged());
    socket.on('location:invalidated', (_) => onInvalidated());
    socket.connect();
    return _SocketIoLocationRealtimeSubscription(socket, familyId);
  }
}

class _SocketIoLocationRealtimeSubscription
    implements LocationRealtimeSubscription {
  _SocketIoLocationRealtimeSubscription(this._socket, this._familyId);

  final socket_io.Socket _socket;
  final String _familyId;

  @override
  void dispose() {
    _socket.emit('location:unsubscribe', {'familyId': _familyId});
    _socket.disconnect();
    _socket.dispose();
  }
}
